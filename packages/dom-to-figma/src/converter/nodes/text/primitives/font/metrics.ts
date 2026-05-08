/**
 * Font Metrics Primitives
 *
 * Low-level font metrics extraction and conversion utilities.
 * These primitives handle the core font measurement operations without
 * any higher-level dependencies.
 *
 * @module FontMetricsPrimitives
 */

import type { OpenTypeFont } from "../../types";

/**
 * Comprehensive font metrics extracted from OpenType fonts
 *
 * Contains all essential measurements needed for text layout and rendering,
 * normalized to a consistent format regardless of font implementation details.
 */
export type FontMetrics = {
  /** Units per EM square - the fundamental unit of font measurement */
  unitsPerEm: number;
  /** Distance from baseline to top of ascenders (positive) */
  ascender: number;
  /** Distance from baseline to bottom of descenders (negative) */
  descender: number;
  /** Additional spacing between lines */
  lineGap: number;

  /** Height of capital letters */
  capHeight: number;
  /** Height of lowercase letters (typically 'x') */
  xHeight: number;

  /** Total line height (ascender - descender + lineGap) */
  lineHeight: number;
  /** Distance from origin to baseline */
  baseline: number;

  /** Font family name */
  familyName: string;
  /** Font style name (e.g., "Regular", "Bold") */
  styleName: string;
};

/**
 * Extract comprehensive font metrics from a fontkit font.
 *
 * Provides robust metrics extraction with fallbacks for missing data.
 * Normalizes metrics across font formats.
 */
export function extractFontMetrics(font: OpenTypeFont): FontMetrics {
  const unitsPerEm = font.unitsPerEm;

  const ascender = font.ascent;
  const descender = font.descent;
  const lineGap = font.lineGap ?? 0;

  // fontkit exposes capHeight/xHeight as top-level getters with a built-in
  // fallback to the closest available metric, so no manual `os2?.sCapHeight`
  // chain is needed.
  const capHeight = font.capHeight ?? Math.round(unitsPerEm * 0.7);
  const xHeight = font.xHeight ?? Math.round(unitsPerEm * 0.5);

  const lineHeight = ascender - descender + lineGap;
  const baseline = Math.abs(descender);

  return {
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    capHeight,
    xHeight,
    lineHeight,
    baseline,
    familyName: font.familyName ?? font.fullName ?? "Unknown",
    styleName: font.subfamilyName ?? "Regular",
  };
}

/**
 * Convert font units to pixel units at a given font size
 *
 * Essential utility for converting between font coordinate space and
 * pixel coordinate space. All font measurements are in font units
 * and must be scaled to match the desired pixel size.
 *
 * @param fontUnits - Value in font units
 * @param fontSize - Target font size in pixels
 * @param unitsPerEm - Font's units per EM value
 * @returns Value converted to pixels
 * @throws {Error} When unitsPerEm is invalid
 *
 * @example
 * ```typescript
 * const pixelWidth = fontUnitsToPixels(500, 24, 2048); // ~5.86px
 * const lineHeightPx = fontUnitsToPixels(metrics.lineHeight, 16, metrics.unitsPerEm);
 * ```
 */
export function fontUnitsToPixels(
  fontUnits: number,
  fontSize: number,
  unitsPerEm: number
): number {
  if (unitsPerEm <= 0) {
    throw new Error("unitsPerEm must be positive for font unit conversion");
  }
  return (fontUnits / unitsPerEm) * fontSize;
}
