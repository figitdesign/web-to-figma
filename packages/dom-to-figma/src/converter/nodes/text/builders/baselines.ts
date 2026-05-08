/**
 * Figma Baseline Builder
 *
 * Creates baseline data structures required by Figma text nodes.
 * Handles both single-line and multi-line text layouts.
 *
 * @module BaselineBuilder
 */

import type { FontMetrics } from "../primitives/font";
import type { ProcessedTextLayout } from "../types";

/**
 * Figma baseline data structure
 */
export type FigmaBaseline = {
  /** Y position of the baseline */
  baseline: number;
  /** Start character index for this baseline */
  characterStart: number;
  /** End character index for this baseline */
  characterEnd: number;
};

/**
 * Build baselines array for Figma text positioning
 *
 * Creates the baseline data required by Figma for proper text rendering
 * and editing. Handles both single-line and multi-line layouts.
 *
 * @param layout - Processed text layout with glyph positions
 * @param fontSize - Font size in pixels
 * @param alignment - Text alignment ('left', 'center', 'right')
 * @param containerWidth - Container width for alignment (optional)
 * @param metrics - Font metrics for baseline calculations
 * @returns Array of baseline objects for Figma
 *
 * @example
 * ```typescript
 * const baselines = buildBaselines(layout, 16, 'left', 200, fontMetrics);
 * console.log(`Generated ${baselines.length} baselines`);
 * ```
 */
export function buildBaselines(
  layout: ProcessedTextLayout,
  fontSize: number,
  alignment: "left" | "center" | "right",
  containerWidth: number | undefined,
  metrics: FontMetrics
): Array<FigmaBaseline> {
  if (layout.isMultiLine && layout.multiLineLayout) {
    const result = buildMultiLineBaselines(
      layout,
      fontSize,
      alignment,
      containerWidth,
      metrics
    );
    return result;
  }
  const result = buildSingleLineBaseline(
    layout,
    fontSize,
    alignment,
    containerWidth,
    metrics
  );
  return result;
}

/**
 * Build baselines for multi-line text
 *
 * Creates a baseline for each line in multi-line text layouts.
 * Each baseline corresponds to one line of text with its own character range.
 *
 * @param layout - Multi-line text layout
 * @param fontSize - Font size in pixels
 * @param _alignment - Text alignment (unused in current implementation)
 * @param _containerWidth - Container width (unused in current implementation)
 * @param metrics - Font metrics
 * @returns Array of baselines, one per line
 *
 * @internal
 */
function buildMultiLineBaselines(
  layout: ProcessedTextLayout,
  fontSize: number,
  _alignment: "left" | "center" | "right",
  _containerWidth: number | undefined,
  metrics: FontMetrics
): Array<FigmaBaseline> {
  const baselines: Array<FigmaBaseline> = [];
  let characterIndex = 0;

  if (!layout.multiLineLayout) {
    return []; // No multi-line data available
  }

  for (
    let lineIndex = 0;
    lineIndex < layout.multiLineLayout.lines.length;
    lineIndex += 1
  ) {
    const line = layout.multiLineLayout.lines[lineIndex];
    if (!line) {
      continue;
    }

    // Calculate baseline Y position for this line
    const lineHeight =
      layout.options.lineHeight ??
      calculateDefaultLineHeight(fontSize, metrics);
    const lineY = lineIndex * lineHeight;
    const baselineOffset = calculateBaselineOffset(
      fontSize,
      metrics,
      layout.options.lineHeight
    );
    const baselineY = lineY + baselineOffset;

    // Determine character range for this line. Figma uses [start, end)
    // half-open intervals here — endCharacter is one past the last glyph.
    const lineLength = line.positions.length || 0;
    const characterStart = characterIndex;
    const characterEnd = characterIndex + lineLength;

    baselines.push({
      baseline: baselineY,
      characterStart,
      characterEnd,
    });

    characterIndex += lineLength;
  }

  return baselines;
}

/**
 * Build baseline for single-line text
 *
 * Creates a single baseline that spans the entire text content.
 * Used for non-wrapping text or text that fits on one line.
 *
 * @param layout - Single-line text layout
 * @param fontSize - Font size in pixels
 * @param _alignment - Text alignment (unused in current implementation)
 * @param _containerWidth - Container width (unused in current implementation)
 * @param metrics - Font metrics
 * @returns Array with single baseline object
 *
 * @internal
 */
function buildSingleLineBaseline(
  layout: ProcessedTextLayout,
  fontSize: number,
  _alignment: "left" | "center" | "right",
  _containerWidth: number | undefined,
  metrics: FontMetrics
): Array<FigmaBaseline> {
  const baselineY = calculateBaselineOffset(
    fontSize,
    metrics,
    layout.options.lineHeight
  );
  const characterCount = layout.positions.length;

  return [
    {
      baseline: baselineY,
      characterStart: 0,
      // Half-open interval — endCharacter is one past the last glyph index,
      // i.e. equal to the character count.
      characterEnd: characterCount,
    },
  ];
}

/**
 * Calculate baseline offset from the top of the text bounding box
 *
 * Determines the Y position where the text baseline should be positioned
 * relative to the top of the text container.
 *
 * @param fontSize - Font size in pixels
 * @param metrics - Font metrics
 * @returns Baseline offset in pixels from top
 *
 * @example
 * ```typescript
 * const offset = calculateBaselineOffset(16, fontMetrics);
 * // Text baseline will be positioned at containerTop + offset
 * ```
 */
function calculateBaselineOffset(
  fontSize: number,
  metrics: FontMetrics,
  htmlLineHeight?: number
): number {
  if (htmlLineHeight) {
    // CSS half-leading model: distribute extra leading equally above and below,
    // then place the baseline at halfLeading + ascender
    const ascenderPx = (metrics.ascender / metrics.unitsPerEm) * fontSize;
    const descenderPx = (metrics.descender / metrics.unitsPerEm) * fontSize;
    const textHeight = ascenderPx - descenderPx;
    const halfLeading = (htmlLineHeight - textHeight) / 2;
    return halfLeading + ascenderPx;
  }

  // Fallback to font metrics if no HTML line height
  const result = (metrics.baseline / metrics.unitsPerEm) * fontSize;
  return result;
}

/**
 * Calculate default line height when not specified
 *
 * @param fontSize - Font size in pixels
 * @param metrics - Font metrics
 * @returns Default line height in pixels
 *
 * @internal
 */
function calculateDefaultLineHeight(
  fontSize: number,
  metrics: FontMetrics
): number {
  // Use font's line height or fall back to 1.2x font size
  const fontLineHeight = (metrics.lineHeight / metrics.unitsPerEm) * fontSize;
  return fontLineHeight > 0 ? fontLineHeight : fontSize * 1.2;
}
