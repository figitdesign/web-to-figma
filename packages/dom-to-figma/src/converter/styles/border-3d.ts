import Color from "colorjs.io";

/**
 * CSS 3D border styles (`groove`, `ridge`, `inset`, `outset`).
 *
 * Chrome paints these by shading each side of the border relative to a light
 * source in the top-left: the sides facing the light keep the declared color
 * and the sides facing away are darkened. `groove`/`ridge` split every side in
 * half and shade the two halves in opposite directions, which is what produces
 * the carved/raised bevel.
 *
 * None of that is expressible as a Figma stroke, so `border-decomposition.ts`
 * paints the shaded bands as filled trapezoids. This module is the color half:
 * it reproduces Blink's `BoxBorderPainter` shading exactly, so the trapezoids
 * carry the same colors Chrome rasterizes.
 */

export type Border3dStyle = "groove" | "ridge" | "inset" | "outset";

type SideKey = "top" | "right" | "bottom" | "left";

type Rgb255 = { r: number; g: number; b: number };

const BORDER_3D_STYLES: ReadonlyArray<string> = [
  "groove",
  "ridge",
  "inset",
  "outset",
];

/**
 * Blink converts the shaded float channels back to bytes through
 * `nextafterf(256, 0)` and truncates, not `* 255` and rounds — the difference
 * is a whole byte on dark colors (`#202060` darkens to `#03030b`, not
 * `#04040c`), so the exact constant matters. `nextafterf` steps by one float32
 * ULP, which just below 256 (= 2^8, 24-bit mantissa) is 2^-16.
 */
const CHANNEL_SCALE = 256 - 2 ** -16;

/** Blink's `Color::Dark()`: pull every channel down until the brightest one
 * loses 0.33, so the shading is proportional and hue-preserving. */
const SHADE_DELTA = 0.33;

/** Blink's `Color::Light()` special case for pure black, which has no channel
 * to scale up — it lightens to a fixed mid grey instead. */
const LIGHTENED_BLACK: Rgb255 = { r: 0x54, g: 0x54, b: 0x54 };

/**
 * Below this WCAG contrast ratio between a color and its darkened self, the
 * bevel would be invisible, so Chrome lightens the lit sides instead of relying
 * on the darkened ones to carry the contrast. Blink's
 * `kMinimumBorderEdgeContrastRatio`.
 */
const MINIMUM_EDGE_CONTRAST_RATIO = 1.75;

export function isBorder3dStyle(style: string): style is Border3dStyle {
  return BORDER_3D_STYLES.includes(style);
}

function toByte(channel: number, multiplier: number): number {
  return Math.trunc(channel * multiplier * CHANNEL_SCALE);
}

function darken(rgb: Rgb255): Rgb255 {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const v = Math.max(r, g, b);
  const multiplier = v <= 0 ? 0 : Math.max(0, (v - SHADE_DELTA) / v);
  return {
    r: toByte(r, multiplier),
    g: toByte(g, multiplier),
    b: toByte(b, multiplier),
  };
}

function lighten(rgb: Rgb255): Rgb255 {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const v = Math.max(r, g, b);
  if (v <= 0) {
    return LIGHTENED_BLACK;
  }
  const multiplier = Math.min(1, v + SHADE_DELTA) / v;
  return {
    r: toByte(r, multiplier),
    g: toByte(g, multiplier),
    b: toByte(b, multiplier),
  };
}

function relativeLuminance(rgb: Rgb255): number {
  const channel = (byte: number) => {
    const s = byte / 255;
    return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

function contrastRatio(a: Rgb255, b: Rgb255): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `groove` and `ridge` are each two bevels stacked: one half of the border is
 * painted as `inset` and the other as `outset`, which is what makes a groove
 * read as carved-in and a ridge as raised-out. `inset`/`outset` shade both
 * halves the same way.
 */
function halfStyle(
  style: Border3dStyle,
  half: "outer" | "inner"
): "inset" | "outset" {
  if (style === "groove") {
    return half === "outer" ? "inset" : "outset";
  }
  if (style === "ridge") {
    return half === "outer" ? "outset" : "inset";
  }
  return style;
}

/**
 * The color Chrome rasterizes for one half of one side of a 3D border.
 *
 * Returns a CSS `rgb()`/`rgba()` string so it can flow through the same
 * `cssColorToFigmaColor` path as any other border color. Falls back to the
 * declared color when it cannot be parsed.
 */
export function border3dSideColor(params: {
  style: Border3dStyle;
  side: SideKey;
  half: "outer" | "inner";
  color: string;
}): string {
  const { style, side, half, color } = params;

  let parsed: Color;
  try {
    parsed = new Color(color);
  } catch {
    return color;
  }
  const alpha = Number(parsed.alpha);
  const base: Rgb255 = {
    r: Math.round((parsed.srgb[0] ?? 0) * 255),
    g: Math.round((parsed.srgb[1] ?? 0) * 255),
    b: Math.round((parsed.srgb[2] ?? 0) * 255),
  };

  // The light source sits top-left: `outset` lights the top and left sides,
  // `inset` lights the bottom and right ones.
  const isTopLeft = side === "top" || side === "left";
  const shaded = darken(base);
  const lit =
    contrastRatio(base, shaded) >= MINIMUM_EDGE_CONTRAST_RATIO
      ? base
      : lighten(base);
  const rgb = isTopLeft === (halfStyle(style, half) === "inset") ? shaded : lit;

  return alpha >= 1
    ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
    : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
