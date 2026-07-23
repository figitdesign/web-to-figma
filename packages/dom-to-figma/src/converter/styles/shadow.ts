import type { FigmaEffect, FigmaPaint } from "../types";
import { createSolidPaint, cssColorToFigmaColor } from "./color";

/**
 * Parse a CSS box-shadow value and convert it to Figma effects
 * Supports multiple shadows separated by commas
 * Format: [inset] <offset-x> <offset-y> [blur-radius] [spread-radius] [color]
 *
 * @param boxShadow - The CSS box-shadow value to parse.
 * @returns An array of Figma effects.
 */
export function cssBoxShadowToFigmaEffects(
  boxShadow: string
): Array<FigmaEffect> {
  if (!boxShadow || boxShadow === "none") {
    return [];
  }

  const effects: Array<FigmaEffect> = [];

  // Properly split by comma, respecting parentheses
  const shadows: Array<string> = [];
  let currentShadow = "";
  let parenDepth = 0;

  for (const char of boxShadow) {
    if (char === "(") {
      parenDepth += 1;
      currentShadow += char;
    } else if (char === ")") {
      parenDepth -= 1;
      currentShadow += char;
    } else if (char === "," && parenDepth === 0) {
      if (currentShadow.trim()) {
        shadows.push(currentShadow.trim());
      }
      currentShadow = "";
    } else {
      currentShadow += char;
    }
  }
  if (currentShadow.trim()) {
    shadows.push(currentShadow.trim());
  }

  for (const shadow of shadows) {
    const effect = parseSingleBoxShadow(shadow);

    if (effect) {
      effects.push(effect);
    }
  }

  return effects;
}

/**
 * Parse a CSS `text-shadow` value into Figma DROP_SHADOW effects. `text-shadow`
 * shares the box-shadow grammar (`<offset-x> <offset-y> <blur>? <color>?`,
 * comma-separated) but has no `inset` keyword and no spread radius, so it reuses
 * the box-shadow parser and normalizes every result to an offset drop shadow
 * with zero spread. On a Figma TEXT node a DROP_SHADOW follows the glyph
 * outlines, matching how CSS paints `text-shadow` behind the text.
 *
 * @param textShadow - The CSS text-shadow value to parse.
 * @returns An array of Figma DROP_SHADOW effects.
 */
export function cssTextShadowToFigmaEffects(
  textShadow: string
): Array<FigmaEffect> {
  const effects: Array<FigmaEffect> = [];
  for (const effect of cssBoxShadowToFigmaEffects(textShadow)) {
    // Box-shadow parsing only yields shadow effects; text-shadow is never
    // inset, so coerce to DROP_SHADOW and discard any spread it never has.
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      effects.push({ ...effect, type: "DROP_SHADOW", spread: 0 });
    }
  }
  return effects;
}

/**
 * Parses a single box shadow string and converts it to a Figma effect.
 * @param shadow - The box shadow string to parse.
 * @returns A Figma effect, or null if the string is invalid.
 */
function parseSingleBoxShadow(shadow: string): FigmaEffect | null {
  // Check if it's an inset shadow
  const isInset = shadow.includes("inset");
  const cleanShadow = shadow.replace(/inset/gi, "").trim();

  // Regular expression to match shadow values
  // Matches: offset-x offset-y [blur] [spread] [color]
  const parts: Array<string> = [];
  let currentPart = "";
  let inFunction = 0;

  for (const char of cleanShadow) {
    if (char === "(") {
      inFunction += 1;
      currentPart += char;
    } else if (char === ")") {
      inFunction -= 1;
      currentPart += char;
    } else if (char === " " && inFunction === 0 && currentPart) {
      parts.push(currentPart);
      currentPart = "";
    } else {
      currentPart += char;
    }
  }
  // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
  if (currentPart) {
    parts.push(currentPart);
  }

  // Parse the parts
  const values: Array<number> = [];
  let colorString = "";

  for (const part of parts) {
    // Try to parse as number with unit
    const numMatch = /^(-?\d*\.?\d+)(px|em|rem)?$/.exec(part);
    if (numMatch?.[1] && values.length < 4) {
      values.push(Number.parseFloat(numMatch[1]));
    } else {
      // Assume it's a color
      // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
      colorString = colorString ? `${colorString} ${part}` : part;
    }
  }

  if (values.length < 2) {
    return null; // Need at least offset-x and offset-y
  }

  const offsetX = values[0] ?? 0;
  const offsetY = values[1] ?? 0;
  const blurRadius = values[2] ?? 0;
  const spreadRadius = values[3] ?? 0;
  const color = cssColorToFigmaColor(colorString);

  // Skip shadows with no visual effect (0 offset, 0 blur, 0 spread, and transparent)
  if (
    offsetX === 0 &&
    offsetY === 0 &&
    blurRadius === 0 &&
    spreadRadius === 0 &&
    !color
  ) {
    return null;
  }

  return {
    type: isInset ? "INNER_SHADOW" : "DROP_SHADOW",
    visible: true,
    blendMode: "NORMAL",
    color: {
      r: color?.color.r ?? 0,
      g: color?.color.g ?? 0,
      b: color?.color.b ?? 0,
      a: color?.opacity ?? 1,
    },
    offset: {
      x: offsetX,
      y: offsetY,
    },
    radius: Math.max(0, blurRadius),
    spread: spreadRadius,
    showShadowBehindNode: false,
  };
}

/**
 * A "pure ring" box-shadow (`0 0 0 <spread> <color>`) is a crisp solid outline
 * around the box in CSS. Figma does not draw a zero-blur/zero-offset spread
 * DROP_SHADOW at all, so such a shadow renders as nothing. These are better
 * represented as an OUTSIDE stroke (see {@link ringShadowToStroke}).
 *
 * @param effect - A Figma effect produced from a CSS box-shadow.
 * @returns True when the effect is a visible, offset-less, blur-less, positive
 *   spread drop shadow.
 */
export function isPureRingShadow(effect: FigmaEffect): boolean {
  if (effect.type !== "DROP_SHADOW") {
    return false;
  }
  return (
    effect.offset.x === 0 &&
    effect.offset.y === 0 &&
    effect.radius === 0 &&
    (effect.spread ?? 0) > 0 &&
    effect.color.a > 0
  );
}

/**
 * Convert a pure-ring drop shadow (see {@link isPureRingShadow}) into the Figma
 * stroke fields that reproduce it: an OUTSIDE stroke whose weight equals the
 * CSS spread and whose paint is the shadow color. With `strokeAlign: OUTSIDE`
 * the stroke sits entirely outside the node without changing its size and
 * follows the node's corner radius, matching the CSS ring.
 *
 * @param effect - A pure-ring drop shadow effect.
 * @returns Stroke fields to spread onto the frame node change.
 */
export function ringShadowToStroke(effect: FigmaEffect): {
  strokeWeight: number;
  strokePaints: Array<FigmaPaint>;
  strokeAlign: "OUTSIDE";
} {
  const spread = effect.spread ?? 0;
  const color = effect.color ?? { r: 0, g: 0, b: 0, a: 1 };
  return {
    strokeWeight: spread,
    strokePaints: [
      createSolidPaint({ r: color.r, g: color.g, b: color.b, a: 1 }, color.a),
    ],
    strokeAlign: "OUTSIDE",
  };
}
