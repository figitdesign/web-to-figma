import type { FigmaColor, FigmaPaint, FigmaTransform } from "../types";
import { cssColorToFigmaColor } from "./color";

type GradientStop = {
  color: FigmaColor;
  position: number;
};

/**
 * Parses a gradient stop string and returns a GradientStop object.
 * @param stopString - The string to parse.
 * @param index - The index of the stop.
 * @param totalStops - The total number of stops.
 * @returns A GradientStop object, or null if the string is invalid.
 */
function parseGradientStop(
  stopString: string,
  index: number,
  totalStops: number
): GradientStop | null {
  const parts = stopString.trim().split(/\s+(?=\d+(?:%|px)?\s*$)/);

  if (parts.length === 0) {
    return null;
  }

  const colorString = parts[0];
  let position: number;

  if (parts.length > 1) {
    const positionString = parts[1];
    if (positionString?.endsWith("%")) {
      position = Number.parseFloat(positionString) / 100;
    } else if (positionString?.endsWith("px")) {
      position = index / (totalStops - 1);
    } else if (positionString) {
      position = Number.parseFloat(positionString);
    } else {
      position = index / (totalStops - 1);
    }
  } else {
    position = index / (totalStops - 1);
  }

  position = Math.max(0, Math.min(1, position));

  try {
    const result = cssColorToFigmaColor(colorString ?? "");
    const color: FigmaColor = result
      ? {
          r: result.color.r,
          g: result.color.g,
          b: result.color.b,
          a: result.opacity,
        }
      : { r: 0, g: 0, b: 0, a: 0 };

    return {
      color,
      position,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a linear gradient angle string and returns the angle in degrees.
 * @param angleString - The string to parse.
 * @returns The angle in degrees.
 */
function parseLinearGradientAngle(angleString: string): number {
  const trimmedAngleString = angleString.trim();

  if (trimmedAngleString.includes("to ")) {
    const direction = trimmedAngleString.replace("to ", "").trim();
    switch (direction) {
      case "top":
        return 0;
      case "right":
        return 90;
      case "bottom":
        return 180;
      case "left":
        return 270;
      case "top right":
        return 45;
      case "bottom right":
        return 135;
      case "bottom left":
        return 225;
      case "top left":
        return 315;
      default:
        return 180;
    }
  }

  if (trimmedAngleString.endsWith("deg")) {
    return Number.parseFloat(trimmedAngleString);
  }

  if (trimmedAngleString.endsWith("rad")) {
    return Number.parseFloat(trimmedAngleString) * (180 / Math.PI);
  }

  if (trimmedAngleString.endsWith("turn")) {
    return Number.parseFloat(trimmedAngleString) * 360;
  }

  return 180;
}

/** The box a gradient paints into. Needed because CSS sizes a gradient against
 * the element's real dimensions, while Figma's transform is in 0..1 space. */
export type GradientBox = {
  width: number;
  height: number;
};

const DEFAULT_BOX: GradientBox = { width: 1, height: 1 };

/**
 * Calculates the gradient transform for a given angle.
 *
 * Figma reads the gradient's progress off the first row: `t = m00·x + m01·y +
 * m02`, with `x`/`y` normalised to 0..1 across the node. CSS measures 0deg as
 * "to top" and increases clockwise, which in Figma's y-down space is the unit
 * vector `(sin, -cos)`.
 *
 * The box matters: CSS runs the gradient along a line of length
 * `|w·sin| + |h·cos|`, so the end stops land exactly on the corners the browser
 * uses. Normalising by that length reproduces the browser's ramp instead of an
 * approximation that only agrees on the vertical axis.
 *
 * @param angleDegrees - The angle in degrees.
 * @param box - The element's box in CSS pixels.
 * @returns The gradient transform.
 */
function calculateGradientTransform(
  angleDegrees: number,
  box: GradientBox = DEFAULT_BOX
): FigmaTransform {
  const radians = angleDegrees * (Math.PI / 180);
  const dirX = Math.sin(radians);
  const dirY = -Math.cos(radians);

  const width = box.width > 0 ? box.width : 1;
  const height = box.height > 0 ? box.height : 1;
  const lineLength = Math.abs(width * dirX) + Math.abs(height * dirY);

  // Degenerate box: fall back to a top-to-bottom ramp rather than dividing by 0.
  if (lineLength === 0) {
    return { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 };
  }

  const m00 = (width * dirX) / lineLength;
  const m01 = (height * dirY) / lineLength;

  return {
    m00,
    m01,
    m02: 0.5 - 0.5 * (m00 + m01),
    // Perpendicular axis: unused for the colour ramp, but keeps the matrix
    // invertible so Figma can round-trip the paint.
    m10: -m01,
    m11: m00,
    m12: 0.5 - 0.5 * (m00 - m01),
  };
}

/**
 * Transform for a CSS `radial-gradient`, which Figma reads as the ellipse
 * inscribed in gradient space: progress is the distance from `(0.5, 0.5)`
 * measured in units of `0.5`.
 *
 * Only the default `ellipse farthest-corner at center` geometry is modelled —
 * that ellipse has radii `(√2/2)·w` and `(√2/2)·h`, i.e. `√2/2` once
 * normalised, independent of the box's aspect ratio.
 */
function calculateRadialTransform(): FigmaTransform {
  const radius = Math.SQRT2 / 2;
  const scale = 1 / (2 * radius);
  const offset = 0.5 - 0.5 * scale;

  return {
    m00: scale,
    m01: 0,
    m02: offset,
    m10: 0,
    m11: scale,
    m12: offset,
  };
}

/**
 * Parses the colour-stop list shared by every gradient flavour.
 * @param colorStops - The raw stop strings, in source order.
 * @returns The stops sorted by position, or null if fewer than two parsed.
 */
function buildStops(colorStops: Array<string>): Array<GradientStop> | null {
  const stops: Array<GradientStop> = [];
  for (let i = 0; i < colorStops.length; i += 1) {
    const stopString = colorStops[i];
    if (!stopString) {
      continue;
    }

    const stop = parseGradientStop(stopString, i, colorStops.length);
    if (stop) {
      stops.push(stop);
    }
  }

  if (stops.length < 2) {
    return null;
  }

  stops.sort((a, b) => a.position - b.position);

  // Handle transparent colors by making them the same as a visible color but with 0 opacity
  const visibleStops = stops.filter((stop) => stop.color.a > 0);
  if (visibleStops.length > 0) {
    const referenceColor = visibleStops[0]?.color ?? { r: 0, g: 0, b: 0, a: 0 };
    for (const stop of stops) {
      if (
        stop.color.a === 0 &&
        stop.color.r === 0 &&
        stop.color.g === 0 &&
        stop.color.b === 0
      ) {
        // This is a transparent color, use the reference color with 0 opacity
        stop.color = {
          r: referenceColor.r,
          g: referenceColor.g,
          b: referenceColor.b,
          a: 0,
        };
      }
    }
  }

  return stops;
}

/** Splits gradient arguments on top-level commas, keeping `rgb(a, b, c)` whole. */
function splitGradientArgs(content: string): Array<string> {
  return content.split(/,(?![^(]*\))/);
}

/**
 * Parses a linear gradient string and returns a FigmaPaint object.
 * @param cssGradient - The string to parse.
 * @param box - The element's box, used to size the gradient line.
 * @returns A FigmaPaint object, or null if the string is invalid.
 */
function parseLinearGradient(
  cssGradient: string,
  box: GradientBox
): FigmaPaint | null {
  const match = /linear-gradient\s*\((.*)\)/.exec(cssGradient);
  if (!match?.[1]) {
    return null;
  }

  const parts = splitGradientArgs(match[1].trim());

  let angle = 180;
  let colorStops: Array<string> = [];

  if (parts.length > 0 && parts[0]) {
    const firstPart = parts[0].trim();

    const hasAngle =
      firstPart.includes("deg") ||
      firstPart.includes("rad") ||
      firstPart.includes("turn") ||
      firstPart.includes("to ");

    if (hasAngle) {
      angle = parseLinearGradientAngle(firstPart);
      colorStops = parts.slice(1);
    } else {
      colorStops = parts;
    }
  }

  const stops = buildStops(colorStops);
  if (!stops) {
    return null;
  }

  return {
    type: "GRADIENT_LINEAR",
    stops,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    transform: calculateGradientTransform(angle, box),
  };
}

// A leading `circle`/`ellipse`/`closest-side`/`at 20% 30%` argument describes the
// gradient's geometry rather than a colour stop.
const RADIAL_GEOMETRY = /^(circle|ellipse|closest-|farthest-)|(^|\s)at\s/i;

/**
 * Parses a radial gradient string and returns a FigmaPaint object.
 *
 * Geometry arguments are recognised so they are not mistaken for a colour, but
 * only the default centred `farthest-corner` ellipse is reproduced; explicit
 * sizes and positions still paint from the centre.
 *
 * @param cssGradient - The string to parse.
 * @returns A FigmaPaint object, or null if the string is invalid.
 */
function parseRadialGradient(cssGradient: string): FigmaPaint | null {
  const match = /radial-gradient\s*\((.*)\)/.exec(cssGradient);
  if (!match?.[1]) {
    return null;
  }

  const parts = splitGradientArgs(match[1].trim());
  const first = parts[0]?.trim() ?? "";
  const colorStops = RADIAL_GEOMETRY.test(first) ? parts.slice(1) : parts;

  const stops = buildStops(colorStops);
  if (!stops) {
    return null;
  }

  return {
    type: "GRADIENT_RADIAL",
    stops,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    transform: calculateRadialTransform(),
  };
}

/**
 * Converts a CSS background string to an array of FigmaPaint objects.
 * @param cssBackground - The string to convert.
 * @param box - The element's box in CSS pixels; sizes the linear gradient line.
 * @returns An array of FigmaPaint objects.
 */
export function cssBackgroundToFigmaPaints(
  cssBackground: string,
  box: GradientBox = DEFAULT_BOX
): Array<FigmaPaint> {
  if (!cssBackground || cssBackground === "none") {
    return [];
  }

  if (cssBackground.includes("linear-gradient")) {
    const gradientPaint = parseLinearGradient(cssBackground, box);
    if (gradientPaint) {
      return [gradientPaint];
    }
  }

  if (cssBackground.includes("radial-gradient")) {
    const gradientPaint = parseRadialGradient(cssBackground);
    if (gradientPaint) {
      return [gradientPaint];
    }
  }

  return [];
}
