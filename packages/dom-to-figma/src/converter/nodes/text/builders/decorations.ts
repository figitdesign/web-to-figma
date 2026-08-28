/**
 * Font Decorations Primitives
 *
 * Low-level text decoration processing for creating underlines,
 * strikethroughs and overlines in Figma-compatible format.
 *
 * @module FontDecorationsPrimitives
 */

import type { FontMetrics } from "../primitives/font/metrics";
import type { ProcessedTextLayout } from "../types";

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

/** A single CSS `text-decoration-line` keyword we can draw. */
export type DecorationLine = "underline" | "line-through" | "overline";

const DECORATION_LINES: ReadonlyArray<DecorationLine> = [
  "underline",
  "line-through",
  "overline",
];

/**
 * Decoration processing options
 */
export type DecorationOptions = {
  /** The `text-decoration-line` keywords to draw. */
  lines: ReadonlyArray<DecorationLine>;
  /** Font size in pixels */
  fontSize: number;
};

/**
 * Parse a CSS `text-decoration-line` value into the keywords we can draw.
 *
 * The property is a space-separated list (`underline line-through` is legal),
 * so a plain map lookup would miss combinations. Unsupported keywords
 * (`blink`, `spelling-error`, …) are dropped.
 */
export function parseDecorationLines(
  value: string
): ReadonlyArray<DecorationLine> {
  const tokens = new Set(value.trim().toLowerCase().split(/\s+/));
  return DECORATION_LINES.filter((line) => tokens.has(line));
}

/**
 * Process text decorations for the given layout
 *
 * Generates Figma-compatible decoration data based on text layout
 * and CSS decoration properties. Handles word wrapping and per-line
 * positioning.
 *
 * @param layout - Processed text layout with glyph positions
 * @param options - Decoration processing options
 * @returns Array of decoration objects ready for Figma
 *
 * @example
 * ```typescript
 * const decorations = processTextDecorations(layout, {
 *   lines: ["underline"],
 *   fontSize: 16,
 * });
 * ```
 */
export function processTextDecorations(
  layout: ProcessedTextLayout,
  options: DecorationOptions
): Array<TextDecoration> {
  if (options.lines.length === 0 || layout.positions.length === 0) {
    return [];
  }

  const thickness = calculateDecorationThickness(
    layout.metrics,
    options.fontSize
  );
  const decorations: Array<TextDecoration> = [];

  for (const line of options.lines) {
    const offset = decorationOffsetFromBaseline(
      line,
      layout.metrics,
      options.fontSize,
      thickness
    );
    const rects = createDecorationRects(layout, offset, thickness);
    if (rects.length > 0) {
      decorations.push({ rects, styleID: 0 });
    }
  }

  return decorations;
}

/**
 * Offset of a decoration rect's *top* edge from the baseline, in pixels.
 * Positive is below the baseline.
 *
 * Each line is derived from the font's own metrics and then checked against
 * a rendered scene: an overline rests its underside on the ascender line, a
 * line-through is centred on half the cap height, and an underline keeps the
 * calibrated offset that already matched. The metric-derived positions land
 * within ~0.3px of what Chromium paints at 26px.
 *
 * @internal
 */
function decorationOffsetFromBaseline(
  line: DecorationLine,
  metrics: FontMetrics,
  fontSize: number,
  thickness: number
): number {
  const em = (units: number) => (units / metrics.unitsPerEm) * fontSize;

  switch (line) {
    case "overline":
      return -(em(metrics.ascender) + thickness);
    case "line-through":
      return -(em(metrics.capHeight) + thickness) / 2;
    default:
      // Based on ground truth: baseline=14.106, underline=15.316, diff=1.21px
      // for a 14px font, i.e. ~0.086em below the baseline.
      return fontSize * 0.086;
  }
}

/**
 * Calculate decoration thickness
 *
 * `text-decoration-thickness: auto` resolves to the font's own rule
 * thickness, so a 26px Inter rule is ~1.8px — a flat ratio of the font size
 * drew a hairline a quarter that width and left most of the browser's rule
 * showing as a diff.
 *
 * @param metrics - Font metrics carrying the `post` table thickness
 * @param fontSize - Font size in pixels
 * @returns Thickness in pixels
 *
 * @internal
 */
function calculateDecorationThickness(
  metrics: FontMetrics,
  fontSize: number
): number {
  const thickness =
    (metrics.underlineThickness / metrics.unitsPerEm) * fontSize;

  return Math.max(thickness, 0.25); // Minimum thickness for visibility
}

/**
 * Create decoration rectangles, one per visual line of text
 *
 * Generates a separate rect for each line of wrapped text, maintaining
 * proper alignment and positioning.
 *
 * @param layout - Text layout with glyph positions
 * @param offsetFromBaseline - Top edge of the rule relative to the baseline
 * @param thickness - Rule thickness
 * @returns Array of decoration rectangles
 *
 * @internal
 */
function createDecorationRects(
  layout: ProcessedTextLayout,
  offsetFromBaseline: number,
  thickness: number
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
      const lineWidth = lastPos.x - firstPos.x + lastPos.advance;
      const singleLineRect: DecorationRect = {
        x: firstPos.x,
        y: firstPos.y + offsetFromBaseline,
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

    // Offset the rule from this line's glyph baseline
    const firstGlyphY = linePositions[0]?.y ?? 0;
    const lineRuleY = firstGlyphY + offsetFromBaseline;

    // Create the rect for this line
    const firstPos = nonSpacePositions[0];

    if (firstPos) {
      // Use the line's reported width from layout instead of calculating from positions
      // This should be more accurate and match the ground truth better
      const lineRect: DecorationRect = {
        x: firstPos.x,
        y: lineRuleY,
        w: line.width,
        h: thickness,
      };

      rects.push(lineRect);
    }
  }

  return rects;
}
