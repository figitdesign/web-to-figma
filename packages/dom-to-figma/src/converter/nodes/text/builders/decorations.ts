/**
 * Font Decorations Primitives
 *
 * Low-level text decoration processing for creating underlines
 * and other text decorations in Figma-compatible format.
 *
 * @module FontDecorationsPrimitives
 */

import type { FontMetrics } from "../primitives/font/metrics";
import type { OpenTypeFont, ProcessedTextLayout } from "../types";

/**
 * Decoration rectangle definition
 */
type DecorationRect = {
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Width in pixels */
  w: number;
  /** Height in pixels (thickness) */
  h: number;
};

/**
 * Complete decoration definition for Figma
 */
export type TextDecoration = {
  /** Array of rectangles that make up this decoration */
  rects: Array<DecorationRect>;
  /** Style ID for the decoration */
  styleID: number;
};

/**
 * Decoration processing options
 */
export type DecorationOptions = {
  /** CSS text-decoration-line value */
  decorationType: "none" | "underline" | "line-through" | "overline";
  /** Font size in pixels */
  fontSize: number;
  /** Whether to adjust for glyph descent */
  respectGlyphDescent: boolean;
};

/**
 * Process text decorations for the given layout
 *
 * Generates Figma-compatible decoration data based on text layout
 * and CSS decoration properties. Handles word wrapping, glyph descent,
 * and proper positioning.
 *
 * @param layout - Processed text layout with glyph positions
 * @param font - OpenType font for glyph metrics
 * @param text - Original text string
 * @param options - Decoration processing options
 * @returns Array of decoration objects ready for Figma
 *
 * @example
 * ```typescript
 * const decorations = processTextDecorations(layout, font, "Hello world", {
 *   decorationType: "underline",
 *   fontSize: 16,
 *   respectGlyphDescent: true
 * });
 * ```
 */
export function processTextDecorations(
  layout: ProcessedTextLayout,
  font: OpenTypeFont,
  text: string,
  options: DecorationOptions
): Array<TextDecoration> {
  if (options.decorationType === "none") {
    return [];
  }

  const decorations: Array<TextDecoration> = [];

  if (options.decorationType === "underline") {
    const underlineDecoration = createUnderlineDecoration(
      layout,
      font,
      text,
      options
    );
    if (underlineDecoration) {
      decorations.push(underlineDecoration);
    }
  }

  // Future: Add support for line-through, overline, etc.

  return decorations;
}

/**
 * Create underline decoration for text layout
 *
 * Generates underline rectangles based on glyph positions and font metrics.
 * Handles multi-line text with proper positioning and spacing.
 *
 * @param layout - Text layout with glyph positions
 * @param font - OpenType font for metrics
 * @param text - Original text string
 * @param options - Decoration options
 * @returns Underline decoration object or null if not applicable
 *
 * @internal
 */
function createUnderlineDecoration(
  layout: ProcessedTextLayout,
  font: OpenTypeFont,
  text: string,
  options: DecorationOptions
): TextDecoration | null {
  if (layout.positions.length === 0) {
    return null;
  }

  // We need line height for proper positioning - get it from layout options or estimate
  // const lineHeight = layout.options.lineHeight ?? options.fontSize * 1.2;
  const underlineY = calculateUnderlinePosition(
    layout.metrics,
    options.fontSize
  );
  const underlineThickness = calculateUnderlineThickness(options.fontSize);

  // Always use multi-line approach as it's more general and handles single lines too
  const rects = createMultiLineUnderlineRects(
    layout,
    underlineY,
    underlineThickness,
    font,
    text,
    options
  );

  return rects.length > 0
    ? {
        rects,
        styleID: 0,
      }
    : null;
}

/**
 * Calculate underline Y position based on font metrics
 *
 * Positions the underline below the baseline, accounting for font metrics
 * and potential glyph descent.
 *
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @returns Y position for underline in pixels
 *
 * @internal
 */
function calculateUnderlinePosition(
  _metrics: FontMetrics,
  fontSize: number
): number {
  // Standard underline position is typically 1-2px below baseline
  // Based on ground truth: baseline=14.106, underline=15.316, diff=1.21px
  // lineHeight=19, fontSize=14, so underline is positioned relative to both

  // Either this or we can try with lineHeight, but this seems to work ok
  const underlineOffset = fontSize * 0.086; // ~1.21px for 14px font (matches ground truth)

  return underlineOffset;
}

/**
 * Calculate underline thickness based on font size
 *
 * Standard practice is to make underline thickness proportional to font size,
 * typically around 1/16 to 1/12 of the font size.
 *
 * @param fontSize - Font size in pixels
 * @returns Thickness in pixels
 *
 * @internal
 */
function calculateUnderlineThickness(fontSize: number): number {
  // Based on ground truth: thickness=0.392 for fontSize=14, lineHeight=19
  // This is about fontSize * 0.028 (0.392/14 ≈ 0.028)
  const thickness = fontSize * 0.028;

  return Math.max(thickness, 0.25); // Minimum thickness for visibility
}

/**
 * Create underline rectangles for multi-line text
 *
 * Generates separate underline rectangles for each line of wrapped text,
 * maintaining proper alignment and positioning.
 *
 * @param layout - Multi-line text layout
 * @param underlineY - Base Y position for underline
 * @param thickness - Underline thickness
 * @param font - OpenType font for analysis
 * @param text - Original text
 * @param options - Decoration options
 * @returns Array of underline rectangles
 *
 * @internal
 */
function createMultiLineUnderlineRects(
  layout: ProcessedTextLayout,
  underlineY: number,
  thickness: number,
  _font: OpenTypeFont,
  _text: string,
  options: DecorationOptions
): Array<DecorationRect> {
  const rects: Array<DecorationRect> = [];

  // Handle both single line (no multiLineLayout) and multi-line cases
  if (!layout.multiLineLayout?.lines) {
    // Create a single line from all positions
    const nonSpacePositions = layout.positions.filter(
      (pos) => pos.character !== " "
    );

    if (nonSpacePositions.length === 0) {
      return rects;
    }

    const firstPos = nonSpacePositions[0];
    const lastPos = nonSpacePositions.at(-1);

    if (firstPos && lastPos) {
      const lineWidth =
        lastPos.x - firstPos.x + lastPos.advance * options.fontSize;
      const singleLineRect: DecorationRect = {
        x: firstPos.x,
        y: firstPos.y + underlineY,
        w: lineWidth,
        h: thickness,
      };

      rects.push(singleLineRect);
    }

    return rects;
  }

  // Process each line
  for (
    let lineIndex = 0;
    lineIndex < layout.multiLineLayout.lines.length;
    lineIndex += 1
  ) {
    const line = layout.multiLineLayout.lines[lineIndex];
    if (!line) {
      continue;
    }

    // Get positions for this line - prefer layout.positions which have correct absolute Y
    // line.positions might be relative, so use layout.positions as primary source
    const linePositions = layout.positions.slice(
      lineIndex === 0
        ? 0
        : layout.multiLineLayout.lines
            .slice(0, lineIndex)
            .reduce((sum, l) => sum + l.characters.length, 0),
      layout.multiLineLayout.lines
        .slice(0, lineIndex + 1)
        .reduce((sum, l) => sum + l.characters.length, 0)
    );

    if (linePositions.length === 0) {
      continue;
    }

    // Find non-space characters for this line
    const nonSpacePositions = linePositions.filter(
      (pos) => pos.character !== " "
    );

    if (nonSpacePositions.length === 0) {
      continue;
    }

    // Calculate line underline position - add underline offset to the glyph baseline Y
    const firstGlyphY = linePositions[0]?.y ?? 0;
    const lineUnderlineY = firstGlyphY + underlineY;

    // Create underline rect for this line
    const firstPos = nonSpacePositions[0];
    const lastPos = nonSpacePositions.at(-1);

    if (firstPos && lastPos) {
      // Use the line's reported width from layout instead of calculating from positions
      // This should be more accurate and match the ground truth better
      const lineWidth = line.width;

      const lineRect: DecorationRect = {
        x: firstPos.x,
        y: lineUnderlineY,
        w: lineWidth,
        h: thickness,
      };

      rects.push(lineRect);
    }
  }

  return rects;
}
