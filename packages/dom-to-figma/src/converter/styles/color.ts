import Color from "colorjs.io";

import type { FigmaColor, FigmaPaint } from "../types";

export const TRANSPARENT_COLOR_VALUES = [
  "none",
  "transparent",
  "rgba(0, 0, 0, 0)",
];

export function cssColorToFigmaColor(cssColor: string): {
  color: FigmaColor;
  opacity: number;
} | null {
  // Check if the color is transparent
  if (TRANSPARENT_COLOR_VALUES.includes(cssColor)) {
    return null;
  }

  let color: Color;
  try {
    color = new Color(cssColor);
  } catch {
    // A paint server (`url(#gradient)`), `context-fill`, or a syntax colorjs does not know: no
    // solid colour. Throwing here dropped the whole layer.
    return null;
  }

  return {
    color: {
      r: color.srgb[0] ?? 0,
      g: color.srgb[1] ?? 0,
      b: color.srgb[2] ?? 0,
      a: 1,
    },
    opacity: Number(color.alpha),
  };
}

export function createSolidPaint(color: FigmaColor, opacity = 1): FigmaPaint {
  return {
    type: "SOLID",
    color,
    visible: true,
    opacity,
    blendMode: "NORMAL",
    // transform: {
    //   m00: 1.0,
    //   m01: 0.0,
    //   m02: 0.0,
    //   m10: 0.0,
    //   m11: 1.0,
    //   m12: 0.0,
    // },
  };
}
