import type { FigmaColor, FigmaPaint, FigmaTransform } from "../types";
import { cssColorToFigmaColor } from "./color";

type GradientStop = {
  color: FigmaColor;
  position: number;
};

/**
 * How a stop's explicit position is measured.
 *
 * `length` covers linear and radial gradients, where CSS writes offsets in `px`
 * along a gradient line whose length depends on the box; `angle` covers conic
 * gradients, where offsets are angles around the centre.
 */
type StopUnits = { kind: "length"; lineLengthPx: number } | { kind: "angle" };

/** Trailing `<length>`/`<percentage>`/`<angle>` that positions a colour stop. */
const STOP_POSITION = /\s+(?=[-+]?[\d.]+(?:%|px|deg|rad|grad|turn)?\s*$)/;

/**
 * Resolves an explicit stop position to a fraction of the gradient line.
 * @param positionString - The trailing position token, e.g. `10px` or `90deg`.
 * @param units - How lengths and angles map onto the line for this gradient.
 * @returns The fraction, or null if the token is not a position we understand.
 */
function resolveStopPosition(
  positionString: string,
  units: StopUnits
): number | null {
  const value = Number.parseFloat(positionString);
  if (Number.isNaN(value)) {
    return null;
  }

  if (positionString.endsWith("%")) {
    return value / 100;
  }

  if (units.kind === "angle") {
    if (positionString.endsWith("turn")) {
      return value;
    }
    if (positionString.endsWith("rad")) {
      return value / (2 * Math.PI);
    }
    if (positionString.endsWith("grad")) {
      return value / 400;
    }
    // Bare numbers are not valid here, but `deg` is the overwhelming default.
    return value / 360;
  }

  if (positionString.endsWith("px")) {
    // A degenerate line has no length to measure against; let the caller fall
    // back to even distribution rather than dividing by zero.
    return units.lineLengthPx > 0 ? value / units.lineLengthPx : null;
  }

  return null;
}

/**
 * Parses a gradient stop string and returns a GradientStop object.
 *
 * The returned position is *not* clamped — repeating gradients need the raw
 * offsets to work out their period before the ramp is tiled across the line.
 *
 * @param stopString - The string to parse.
 * @param index - The index of the stop.
 * @param totalStops - The total number of stops.
 * @param units - How to measure an explicit position on this gradient's line.
 * @returns A GradientStop object, or null if the string is invalid.
 */
function parseGradientStop(
  stopString: string,
  index: number,
  totalStops: number,
  units: StopUnits
): GradientStop | null {
  const parts = stopString.trim().split(STOP_POSITION);

  if (parts.length === 0) {
    return null;
  }

  const colorString = parts[0];
  const evenPosition = totalStops > 1 ? index / (totalStops - 1) : 0;
  const explicit =
    parts.length > 1 && parts[1] ? resolveStopPosition(parts[1], units) : null;
  const position = explicit ?? evenPosition;

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
function linearLineLength(
  angleDegrees: number,
  box: GradientBox = DEFAULT_BOX
): number {
  const radians = angleDegrees * (Math.PI / 180);
  const width = box.width > 0 ? box.width : 1;
  const height = box.height > 0 ? box.height : 1;

  return (
    Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  );
}

function calculateGradientTransform(
  angleDegrees: number,
  box: GradientBox = DEFAULT_BOX
): FigmaTransform {
  const radians = angleDegrees * (Math.PI / 180);
  const dirX = Math.sin(radians);
  const dirY = -Math.cos(radians);

  const width = box.width > 0 ? box.width : 1;
  const height = box.height > 0 ? box.height : 1;
  const lineLength = linearLineLength(angleDegrees, box);

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

/** Ceiling on the stop list a repeat may expand to, so a 1px period on a wide
 * box degrades to a coarse ramp instead of a pathological paint. */
const MAX_TILED_STOPS = 256;

/**
 * Tiles one period of a repeating gradient's ramp across the whole line.
 *
 * Figma has no repeating gradient, so the repetition is baked into the stop
 * list: CSS repeats the ramp every `period`, and replaying it at each multiple
 * reproduces that exactly — hard stops included, because a stop shared by two
 * tiles lands on the same position twice.
 *
 * @param stops - One period of the ramp, sorted, with raw (unclamped) offsets.
 * @returns The tiled stops covering 0..1, or null if the ramp cannot repeat.
 */
function tileRepeatingStops(
  stops: Array<GradientStop>
): Array<GradientStop> | null {
  const start = stops[0]?.position ?? 0;
  const end = stops.at(-1)?.position ?? 0;
  const period = end - start;

  // A zero-length or line-spanning period repeats exactly once: nothing to do.
  if (!(period > 0) || period >= 1) {
    return null;
  }

  const maxTiles = Math.floor(MAX_TILED_STOPS / stops.length);
  // Tiles are laid both ways from the first stop so a ramp that starts part-way
  // down the line still paints the run before it, as CSS does. The epsilon
  // keeps an exact division (a 20px period on a 120px line) from spilling a
  // redundant tile off the end, since the line length carries trig rounding.
  const epsilon = 1e-9;
  const before = Math.ceil(Math.max(0, start) / period - epsilon);
  const after = Math.ceil((1 - start) / period - epsilon);
  if (before + after > maxTiles) {
    return null;
  }

  const tiled: Array<GradientStop> = [];
  for (let tile = -before; tile < after; tile += 1) {
    const offset = tile * period;
    for (const stop of stops) {
      const position = stop.position + offset;
      // Keep one stop of overhang each side so the visible band's end colours
      // are interpolated from a real neighbour rather than clamped flat.
      if (position < -period || position > 1 + period) {
        continue;
      }
      tiled.push({ color: stop.color, position });
    }
  }

  return tiled.length >= 2 ? tiled : null;
}

/**
 * Transform for a CSS `conic-gradient`, whose sweep Figma reads out of gradient
 * space as the angle around `(0.5, 0.5)`.
 *
 * Figma's angular ramp starts at three o'clock; CSS starts at twelve. Rotating
 * gradient space a quarter turn lines the two origins up, so the stop offsets —
 * already fractions of a turn — carry over untouched.
 *
 * Only the default `from 0deg at center` geometry is modelled.
 */
function calculateAngularTransform(): FigmaTransform {
  return { m00: 0, m01: -1, m02: 1, m10: 1, m11: 0, m12: 0 };
}

/** Gap forced between stops that CSS places at the same offset. Far above
 * float32's resolution, far below one pixel on any realistic gradient line. */
const COINCIDENT_STOP_GAP = 1e-5;

/**
 * Pushes coincident stops a hair apart so the list strictly increases.
 *
 * CSS writes a hard stop as two stops at the same offset, and the pair only
 * reads as a hard edge if the colours stay in source order. Figma reorders
 * equal offsets — a 24-stop ramp comes back with the pair at the array's
 * midpoint swapped, turning two flat bands into two ramps — so the order has to
 * be carried by the offsets themselves rather than by position in the array.
 *
 * @param stops - The stops to separate, in source order and already clamped.
 */
function separateCoincidentStops(stops: Array<GradientStop>): void {
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const current = stops[i];
    if (previous && current && current.position <= previous.position) {
      current.position = previous.position + COINCIDENT_STOP_GAP;
    }
  }

  // The forward pass can push the tail past the end of the ramp; walk back to
  // pull it inside without collapsing the gaps it just opened.
  for (let i = stops.length - 1; i > 0; i -= 1) {
    const current = stops[i];
    const previous = stops[i - 1];
    if (!(current && previous)) {
      continue;
    }
    current.position = Math.min(1, current.position);
    if (previous.position >= current.position) {
      previous.position = Math.max(0, current.position - COINCIDENT_STOP_GAP);
    }
  }
}

/**
 * Parses the colour-stop list shared by every gradient flavour.
 * @param colorStops - The raw stop strings, in source order.
 * @param units - How to measure explicit stop positions on this gradient.
 * @param repeating - Whether the ramp should be tiled across the line.
 * @returns The stops sorted by position, or null if fewer than two parsed.
 */
function buildStops(
  colorStops: Array<string>,
  units: StopUnits,
  repeating = false
): Array<GradientStop> | null {
  const parsed: Array<GradientStop> = [];
  for (let i = 0; i < colorStops.length; i += 1) {
    const stopString = colorStops[i];
    if (!stopString) {
      continue;
    }

    const stop = parseGradientStop(stopString, i, colorStops.length, units);
    if (stop) {
      parsed.push(stop);
    }
  }

  if (parsed.length < 2) {
    return null;
  }

  parsed.sort((a, b) => a.position - b.position);

  const stops = (repeating ? tileRepeatingStops(parsed) : null) ?? parsed;

  // Figma reads stop offsets in 0..1; anything outside was only meaningful
  // while the repeat period was being worked out.
  for (const stop of stops) {
    stop.position = Math.max(0, Math.min(1, stop.position));
  }

  separateCoincidentStops(stops);

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
  box: GradientBox,
  repeating = false
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

  const stops = buildStops(
    colorStops,
    { kind: "length", lineLengthPx: linearLineLength(angle, box) },
    repeating
  );
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
function parseRadialGradient(
  cssGradient: string,
  box: GradientBox,
  repeating = false
): FigmaPaint | null {
  const match = /radial-gradient\s*\((.*)\)/.exec(cssGradient);
  if (!match?.[1]) {
    return null;
  }

  const parts = splitGradientArgs(match[1].trim());
  const first = parts[0]?.trim() ?? "";
  const colorStops = RADIAL_GEOMETRY.test(first) ? parts.slice(1) : parts;

  // CSS measures a radial stop along the horizontal radius, which for the
  // default farthest-corner ellipse is `(√2/2)·w` — the same edge Figma's
  // transform maps to position 1.
  const stops = buildStops(
    colorStops,
    {
      kind: "length",
      lineLengthPx: (Math.SQRT2 / 2) * (box.width > 0 ? box.width : 1),
    },
    repeating
  );
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

// A leading `from 45deg` / `at 30% 70%` argument describes the sweep's start
// angle and centre rather than a colour stop.
const CONIC_GEOMETRY = /^from\s|(^|\s)at\s/i;

/**
 * Parses a conic gradient string and returns a FigmaPaint object.
 *
 * Figma's angular paint sweeps clockwise from the same twelve-o'clock origin
 * CSS uses, so the stop offsets carry over as fractions of a full turn and the
 * transform only has to centre the sweep. `from`/`at` are recognised so they
 * are not read as colours, but only the default centred sweep is reproduced.
 *
 * @param cssGradient - The string to parse.
 * @param repeating - Whether the ramp should be tiled around the circle.
 * @returns A FigmaPaint object, or null if the string is invalid.
 */
function parseConicGradient(
  cssGradient: string,
  repeating = false
): FigmaPaint | null {
  const match = /conic-gradient\s*\((.*)\)/.exec(cssGradient);
  if (!match?.[1]) {
    return null;
  }

  const parts = splitGradientArgs(match[1].trim());
  const first = parts[0]?.trim() ?? "";
  const colorStops = CONIC_GEOMETRY.test(first) ? parts.slice(1) : parts;

  const stops = buildStops(colorStops, { kind: "angle" }, repeating);
  if (!stops) {
    return null;
  }

  return {
    type: "GRADIENT_ANGULAR",
    stops,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    transform: calculateAngularTransform(),
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

  // Figma has no repeating gradient; the repeat is baked into the stop list, so
  // the only thing the flavour changes here is how the stops are built.
  const repeating = cssBackground.includes("repeating-");

  if (cssBackground.includes("linear-gradient")) {
    const gradientPaint = parseLinearGradient(cssBackground, box, repeating);
    if (gradientPaint) {
      return [gradientPaint];
    }
  }

  if (cssBackground.includes("radial-gradient")) {
    const gradientPaint = parseRadialGradient(cssBackground, box, repeating);
    if (gradientPaint) {
      return [gradientPaint];
    }
  }

  if (cssBackground.includes("conic-gradient")) {
    const gradientPaint = parseConicGradient(cssBackground, repeating);
    if (gradientPaint) {
      return [gradientPaint];
    }
  }

  return [];
}
