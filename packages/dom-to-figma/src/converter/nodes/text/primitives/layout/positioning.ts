/**
 * Layout Positioning Primitives
 *
 * Low-level text positioning operations including glyph positioning,
 * alignment calculations, and coordinate transformations.
 *
 * @module LayoutPositioningPrimitives
 */

import type { OpenTypeFont } from "../../types";
import type { FontMetrics } from "../font";
import { computeKernings } from "./kerning";
import { scaleAdvanceWidth } from "./scaling";

/**
 * Supported horizontal text alignment options
 */
export type HorizontalAlignment = "left" | "center" | "right";

/**
 * Configuration options for text spacing
 */
export type SpacingOptions = {
  /** Additional letter spacing in pixels */
  letterSpacing?: number;
  /** Additional word spacing in pixels */
  wordSpacing?: number;
};

/**
 * Configuration options for text alignment
 */
export type AlignmentOptions = {
  /** Horizontal alignment preference */
  horizontal: HorizontalAlignment;
  /** Container width for alignment calculations (optional) */
  containerWidth?: number;
  /** Baseline Y position offset (optional) */
  baselineY?: number;
};

/**
 * Position data for a single glyph
 */
export type GlyphPosition = {
  /** The character this position represents */
  character: string;
  /** Horizontal position in pixels */
  x: number;
  /** Vertical position in pixels */
  y: number;
  /** Advance width for this glyph in pixels */
  advance: number;
  /** Glyph index in the font */
  glyphIndex: number;
};

/**
 * Result of text alignment operations
 */
export type AlignedLayout = {
  /** Array of positioned glyphs with alignment applied */
  positions: Array<GlyphPosition>;
  /** Bounding box of the aligned text */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Final baseline Y position */
  baseline: number;
};

/**
 * Calculate positions for a sequence of glyphs
 *
 * Processes text string to determine exact pixel positions for each glyph,
 * including kerning, letter spacing, and advance width calculations.
 *
 * @param font - OpenType.js font object
 * @param text - Text string to position
 * @param metrics - Font metrics for calculations
 * @param fontSize - Font size in pixels
 * @param options - Spacing configuration options
 * @returns Array of positioned glyphs
 *
 * @example
 * ```typescript
 * const positions = calculateGlyphPositions(
 *   font,
 *   "Hello",
 *   metrics,
 *   16,
 *   { letterSpacing: 2 }
 * );
 * ```
 */
export function calculateGlyphPositions(
  font: OpenTypeFont,
  text: string,
  metrics: FontMetrics,
  fontSize: number,
  options: SpacingOptions = {}
): Array<GlyphPosition> {
  if (!(font && text) || fontSize <= 0) {
    return [];
  }

  const { letterSpacing = 0, wordSpacing = 0 } = options;
  const positions: Array<GlyphPosition> = [];
  let currentX = 0;

  // Per-character mapping. The rest of the pipeline (`processGlyphs`, blob
  // lookup at `converter.ts:374`) is keyed by character, so shaped output
  // (e.g. an "fi" ligature glyph) would be silently corrupted anyway.
  const chars = [...text];
  const glyphs = chars.map((char) =>
    font.glyphForCodePoint(char.codePointAt(0) ?? 0)
  );

  // One layout call resolves all pair kernings; index i holds the kern
  // between glyphs[i] and glyphs[i + 1].
  const kernings = computeKernings(font, text, glyphs, metrics, fontSize);

  for (let i = 0; i < glyphs.length; i += 1) {
    const glyph = glyphs[i];
    const char = chars[i];
    if (!(glyph && char)) {
      continue;
    }

    if (i > 0) {
      currentX += kernings[i - 1] ?? 0;
    }

    const advance = scaleAdvanceWidth(glyph, metrics, fontSize);

    positions.push({
      character: char,
      x: currentX,
      y: 0, // Y position will be set by alignment or multi-line layout
      advance,
      glyphIndex: glyph.id,
    });

    let totalAdvance = advance + letterSpacing;
    if (char === " ") {
      totalAdvance += wordSpacing;
    }
    currentX += totalAdvance;
  }

  return positions;
}

/**
 * Apply horizontal alignment to positioned glyphs
 *
 * Adjusts the X positions of all glyphs to achieve the desired horizontal
 * alignment within the available container width.
 *
 * @param positions - Array of positioned glyphs
 * @param metrics - Font metrics for baseline calculations
 * @param fontSize - Font size in pixels
 * @param textWidth - Total width of the text
 * @param options - Alignment configuration
 * @returns Layout with alignment applied
 *
 * @example
 * ```typescript
 * const alignedLayout = createSimpleLayout(positions, metrics, 16, 100, {
 *   horizontal: 'center',
 *   containerWidth: 200
 * });
 * ```
 */
export function createSimpleLayout(
  positions: Array<GlyphPosition>,
  metrics: FontMetrics,
  fontSize: number,
  textWidth: number,
  options: AlignmentOptions,
  preserveY = false // New parameter to preserve existing y coordinates
): AlignedLayout {
  const { horizontal, containerWidth, baselineY } = options;

  // Calculate baseline position
  const baseline = baselineY ?? calculateBaselinePosition(metrics, fontSize);

  // Calculate horizontal offset for alignment
  const xOffset = getHorizontalOffset(horizontal, textWidth, containerWidth);

  // Apply alignment offset to all positions
  const alignedPositions = positions.map((pos) => ({
    ...pos,
    x: pos.x + xOffset,
    y: preserveY ? pos.y : baseline, // Preserve existing y for multi-line, or use baseline for single-line
  }));

  // Calculate bounds
  const bounds = calculateLayoutBounds(alignedPositions, metrics, fontSize);

  return {
    positions: alignedPositions,
    bounds,
    baseline,
  };
}

/**
 * Calculate total text width from positioned glyphs
 *
 * @param font - OpenType.js font object
 * @param text - Text string to measure
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @param options - Spacing options
 * @returns Total text width in pixels
 */
export function calculateTextWidth(
  font: OpenTypeFont,
  text: string,
  metrics: FontMetrics,
  fontSize: number,
  options: SpacingOptions = {}
): number {
  const positions = calculateGlyphPositions(
    font,
    text,
    metrics,
    fontSize,
    options
  );

  if (positions.length === 0) {
    return 0;
  }

  const lastPosition = positions.at(-1);
  if (!lastPosition) {
    return 0;
  }

  return lastPosition.x + lastPosition.advance;
}

/**
 * Calculate X offset for horizontal text alignment
 *
 * @param alignment - Desired horizontal alignment
 * @param textWidth - Total width of the text in pixels
 * @param containerWidth - Width of the container (optional)
 * @returns X offset in pixels to achieve the desired alignment
 */
export function getHorizontalOffset(
  alignment: HorizontalAlignment,
  textWidth: number,
  containerWidth?: number
): number {
  if (!containerWidth || textWidth <= 0) {
    return 0;
  }

  switch (alignment) {
    case "left":
      return 0;
    case "center":
      return Math.max(0, (containerWidth - textWidth) / 2);
    case "right":
      return Math.max(0, containerWidth - textWidth);
    default:
      return 0;
  }
}

/**
 * Calculate baseline position for text
 *
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @returns Baseline Y position in pixels
 */
function calculateBaselinePosition(
  metrics: FontMetrics,
  fontSize: number
): number {
  return (metrics.ascender / metrics.unitsPerEm) * fontSize;
}

/**
 * Calculate bounding box for positioned glyphs
 *
 * @param positions - Array of positioned glyphs
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @returns Bounding box coordinates
 */
function calculateLayoutBounds(
  positions: Array<GlyphPosition>,
  metrics: FontMetrics,
  fontSize: number
): { x: number; y: number; width: number; height: number } {
  if (positions.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // biome-ignore lint/style/noNonNullAssertion: we just checked that positions is not empty above
  const firstPos = positions[0]!;
  // biome-ignore lint/style/noNonNullAssertion: we just checked that positions is not empty above
  const lastPos = positions.at(-1)!;

  const x = firstPos.x;
  const width = lastPos.x + lastPos.advance - firstPos.x;

  const ascender = (metrics.ascender / metrics.unitsPerEm) * fontSize;
  const descender = (metrics.descender / metrics.unitsPerEm) * fontSize;

  const y = firstPos.y - ascender;
  const height = ascender - descender;

  return { x, y, width, height };
}
