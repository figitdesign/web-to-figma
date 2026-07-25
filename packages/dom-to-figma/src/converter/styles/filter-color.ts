import type { FigmaColor } from "../types/core";

// Rec. 709 luma coefficients — the weights CSS uses for grayscale()/saturate().
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

type Rgb = { r: number; g: number; b: number };

/** CSS color-matrix / component-transfer filter functions this module can bake
 * into a solid color. Spatial (`blur`) and shadow (`drop-shadow`) filters are
 * effects, handled elsewhere; `hue-rotate`/`opacity` are intentionally omitted. */
const COLOR_MATRIX_FN =
  /(grayscale|sepia|invert|saturate|brightness|contrast)\(\s*([\d.]+%?)\s*\)/g;

/** Parse a CSS filter amount: `1`, `0.5`, `100%`, `50%` → a unit-relative number. */
function parseAmount(raw: string): number {
  return raw.endsWith("%")
    ? Number.parseFloat(raw) / 100
    : Number.parseFloat(raw);
}

function grayscale(c: Rgb, amount: number): Rgb {
  const a = Math.min(1, amount);
  const luma = LUMA_R * c.r + LUMA_G * c.g + LUMA_B * c.b;
  return {
    r: c.r + a * (luma - c.r),
    g: c.g + a * (luma - c.g),
    b: c.b + a * (luma - c.b),
  };
}

function brightness(c: Rgb, amount: number): Rgb {
  return { r: c.r * amount, g: c.g * amount, b: c.b * amount };
}

function contrast(c: Rgb, amount: number): Rgb {
  const shift = 0.5 - 0.5 * amount;
  return {
    r: c.r * amount + shift,
    g: c.g * amount + shift,
    b: c.b * amount + shift,
  };
}

function invert(c: Rgb, amount: number): Rgb {
  const a = Math.min(1, amount);
  return {
    r: c.r + a * (1 - 2 * c.r),
    g: c.g + a * (1 - 2 * c.g),
    b: c.b + a * (1 - 2 * c.b),
  };
}

function sepia(c: Rgb, amount: number): Rgb {
  const a = Math.min(1, amount);
  const r = 0.393 * c.r + 0.769 * c.g + 0.189 * c.b;
  const g = 0.349 * c.r + 0.686 * c.g + 0.168 * c.b;
  const b = 0.272 * c.r + 0.534 * c.g + 0.131 * c.b;
  return {
    r: c.r + a * (r - c.r),
    g: c.g + a * (g - c.g),
    b: c.b + a * (b - c.b),
  };
}

function saturate(c: Rgb, a: number): Rgb {
  return {
    r:
      (0.213 + 0.787 * a) * c.r +
      (0.715 - 0.715 * a) * c.g +
      (0.072 - 0.072 * a) * c.b,
    g:
      (0.213 - 0.213 * a) * c.r +
      (0.715 + 0.285 * a) * c.g +
      (0.072 - 0.072 * a) * c.b,
    b:
      (0.213 - 0.213 * a) * c.r +
      (0.715 - 0.715 * a) * c.g +
      (0.072 + 0.928 * a) * c.b,
  };
}

function applyOne(fn: string, amount: number, c: Rgb): Rgb {
  switch (fn) {
    case "grayscale":
      return grayscale(c, amount);
    case "brightness":
      return brightness(c, amount);
    case "contrast":
      return contrast(c, amount);
    case "invert":
      return invert(c, amount);
    case "sepia":
      return sepia(c, amount);
    case "saturate":
      return saturate(c, amount);
    default:
      return c;
  }
}

/**
 * Detect whether a CSS `filter` value contains any color-matrix function this
 * module can bake — used to gate the frame converter before touching the fill.
 *
 * @param filter - The CSS filter value.
 * @returns True if at least one bakeable color function is present.
 */
export function hasColorMatrixFilter(filter: string): boolean {
  if (!filter || filter === "none") {
    return false;
  }
  COLOR_MATRIX_FN.lastIndex = 0;
  return COLOR_MATRIX_FN.test(filter);
}

/**
 * Bake CSS color-matrix filters (`grayscale`/`brightness`/`contrast`/`invert`/
 * `sepia`/`saturate`) into a solid color by applying each function to the RGB
 * channels in source order, clamping to [0,1] after each step to mirror how the
 * browser pipes one filter primitive into the next. Alpha is untouched; `blur`
 * and `drop-shadow` in the same value are ignored (they are Figma effects).
 *
 * Figma has no color-filter effect, so this only reproduces the filter when the
 * element's whole appearance is that one solid fill — the caller must gate on
 * that (leaf, no image/border/text). See the frame converter.
 *
 * @param color - The unfiltered fill color.
 * @param filter - The CSS filter value.
 * @returns The filtered color (same `a`).
 */
export function applyCssColorMatrixFilters(
  color: FigmaColor,
  filter: string
): FigmaColor {
  if (!filter || filter === "none") {
    return color;
  }
  let rgb: Rgb = { r: color.r, g: color.g, b: color.b };
  COLOR_MATRIX_FN.lastIndex = 0;
  for (const match of filter.matchAll(COLOR_MATRIX_FN)) {
    const fn = match[1];
    const amount = parseAmount(match[2] ?? "");
    if (!fn || Number.isNaN(amount)) {
      continue;
    }
    rgb = applyOne(fn, amount, rgb);
    rgb = { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b) };
  }
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: color.a };
}
