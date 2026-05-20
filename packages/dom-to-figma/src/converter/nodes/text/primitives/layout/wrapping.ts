/**
 * Text Wrapping and Line Breaking Primitives
 *
 * Handles word wrapping, line breaks, and overflow management.
 * This module provides low-level text wrapping operations for multi-line text layouts.
 *
 * @module WrappingPrimitives
 */

import type { FontMetrics, OpenTypeFont } from "../../types";
import type {
  GlyphPosition,
  HorizontalAlignment,
  SpacingOptions,
} from "./positioning";
import {
  calculateGlyphPositions,
  calculateTextWidth,
  getHorizontalOffset,
} from "./positioning";

/** Extended spacing options with wrapping constraints */
export type WrappingOptions = {
  /** Maximum width before wrapping (pixels) */
  maxWidth?: number;
  /** Whether to wrap at word boundaries (default: true) */
  wordWrap?: boolean;
  /** Whether to break long words that don't fit (default: false) */
  breakWords?: boolean;
  /** Horizontal alignment to apply to each line individually */
  alignment?: HorizontalAlignment;
  /** Container width for alignment calculations */
  containerWidth?: number;
  /** Line height in pixels (overrides font metrics calculation if specified) */
  lineHeight?: number;
  /** Tolerance margin for width calculations (default: 1px) - helps prevent unnecessary wrapping */
  wrapTolerance?: number;
} & SpacingOptions;

/** Data for a single line of text */
type LinePosition = {
  /** Text content of this line */
  characters: string;
  /** Positioned glyphs within this line */
  positions: Array<GlyphPosition>;
  /** Total width of this line */
  width: number;
  /** Height of this line */
  height: number;
  /** Baseline position within this line */
  baseline: number;
};

/**
 * Calculate baseline position using the CSS half-leading model.
 *
 * Distributes extra leading (lineHeight − textHeight) equally above and below
 * the text, then places the baseline at halfLeading + ascender.
 * This matches how browsers and Figma position text within a line box.
 */
function calculateBaselineFromLineHeight(
  lineHeight: number,
  metrics: FontMetrics,
  fontSize: number
): number {
  const ascenderPx = (metrics.ascender / metrics.unitsPerEm) * fontSize;
  const descenderPx = (metrics.descender / metrics.unitsPerEm) * fontSize;
  const textHeight = ascenderPx - descenderPx;
  const halfLeading = (lineHeight - textHeight) / 2;
  return halfLeading + ascenderPx;
}

/** Complete multi-line text layout with overflow information */
export type MultiLineLayout = {
  /** Array of line data */
  lines: Array<LinePosition>;
  /** Maximum width across all lines */
  totalWidth: number;
  /** Total height of all lines */
  totalHeight: number;
  /** Overflow status and clipped content */
  overflow: {
    horizontal: boolean;
    vertical: boolean;
    clippedText?: string;
  };
};

/**
 * Break text into tokens (words, spaces, newlines) for wrapping analysis
 *
 * @param text - Input text to tokenize
 * @returns Array of tokens with type and content
 *
 * @internal
 */
function tokenizeText(
  text: string
): Array<{ type: "word" | "space" | "newline"; content: string }> {
  const tokens: Array<{ type: "word" | "space" | "newline"; content: string }> =
    [];
  let currentWord = "";

  for (const char of text) {
    if (char === " ") {
      // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
      if (currentWord) {
        tokens.push({ type: "word", content: currentWord });
        currentWord = "";
      }
      tokens.push({ type: "space", content: char });
    } else if (char === "\n") {
      // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
      if (currentWord) {
        tokens.push({ type: "word", content: currentWord });
        currentWord = "";
      }
      tokens.push({ type: "newline", content: char });
    } else {
      currentWord += char;
    }
  }

  // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
  if (currentWord) {
    tokens.push({ type: "word", content: currentWord });
  }

  return tokens;
}

/**
 * Calculate width of a text segment
 *
 * @param font - OpenType.js font object
 * @param text - Text segment to measure
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @param options - Spacing options
 * @returns Width in pixels
 *
 * @internal
 */
function calculateSegmentWidth(
  font: OpenTypeFont,
  text: string,
  metrics: FontMetrics,
  fontSize: number,
  options: SpacingOptions
): number {
  return calculateTextWidth(font, text, metrics, fontSize, options);
}

/**
 * Break a word that's too long to fit on a line
 *
 * @param font - OpenType.js font object
 * @param word - Word to break
 * @param maxWidth - Maximum allowed width
 * @param metrics - Font metrics
 * @param fontSize - Font size in pixels
 * @param options - Spacing options
 * @returns Array of word parts that fit within maxWidth
 *
 * @internal
 */
function breakLongWord(
  font: OpenTypeFont,
  word: string,
  maxWidth: number,
  metrics: FontMetrics,
  fontSize: number,
  options: SpacingOptions
): Array<string> {
  const parts: Array<string> = [];
  let currentPart = "";

  for (const char of word) {
    if (!char) {
      continue;
    }
    const testPart = currentPart + char;
    const width = calculateSegmentWidth(
      font,
      testPart,
      metrics,
      fontSize,
      options
    );

    if (width <= maxWidth) {
      currentPart = testPart;
      // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
    } else if (currentPart) {
      parts.push(currentPart);
      currentPart = char;
    } else {
      // Even single character doesn't fit - force it anyway
      parts.push(char);
    }
  }

  // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
  if (currentPart) {
    parts.push(currentPart);
  }

  return parts;
}

/**
 * Calculate multi-line text layout with wrapping
 *
 * Processes text string and applies word wrapping, line breaking, and overflow handling
 * to create a complete multi-line layout structure.
 *
 * @param font - OpenType.js font object
 * @param text - Text string to layout
 * @param metrics - Font metrics for calculations
 * @param fontSize - Font size in pixels
 * @param options - Wrapping configuration options
 * @returns Complete multi-line layout with line data and overflow information
 *
 * @example
 * ```typescript
 * const layout = calculateWrappedLayout(font, "Long text...", metrics, 16, {
 *   maxWidth: 200,
 *   wordWrap: true,
 *   breakWords: false
 * });
 * ```
 */
export function calculateWrappedLayout(
  font: OpenTypeFont,
  text: string,
  metrics: FontMetrics,
  fontSize: number,
  options: WrappingOptions = {}
): MultiLineLayout {
  const {
    maxWidth,
    wordWrap = true,
    breakWords = false,
    letterSpacing = 0,
    lineHeight: customLineHeight,
    wrapTolerance = 2, // Default 2px tolerance
  } = options;

  const lines: Array<LinePosition> = [];
  const lineHeight =
    customLineHeight ?? (metrics.lineHeight / metrics.unitsPerEm) * fontSize;

  // If no width constraint, treat as single line
  if (maxWidth && wordWrap) {
    // Tokenize text for word-based wrapping
    const tokens = tokenizeText(text);
    let currentLine = "";
    let currentLineWidth = 0;

    // Process tokens for line breaking
    for (const token of tokens) {
      // Handle explicit newlines
      if (token.type === "newline") {
        // Finalize current line
        // biome-ignore lint/nursery/noUnnecessaryConditions: <explanation>
        if (currentLine) {
          const positions = calculateGlyphPositions(
            font,
            currentLine,
            metrics,
            fontSize,
            {
              letterSpacing,
            }
          );
          lines.push({
            characters: currentLine,
            positions,
            width: currentLineWidth,
            height: lineHeight,
            baseline: calculateBaselineFromLineHeight(
              lineHeight,
              metrics,
              fontSize
            ),
          });
        }

        currentLine = "";
        currentLineWidth = 0;
        continue;
      }

      const tokenContent = token.content;

      // For words, check if we need to break them
      if (token.type === "word" && breakWords) {
        const wordWidth = calculateSegmentWidth(
          font,
          tokenContent,
          metrics,
          fontSize,
          {
            letterSpacing,
          }
        );
        // Apply tolerance when checking if word needs breaking
        if (wordWidth > maxWidth + wrapTolerance) {
          const wordParts = breakLongWord(
            font,
            tokenContent,
            maxWidth + wrapTolerance,
            metrics,
            fontSize,
            {
              letterSpacing,
            }
          );

          // Process each part as a separate token
          for (const part of wordParts) {
            const partWidth = calculateSegmentWidth(
              font,
              part,
              metrics,
              fontSize,
              {
                letterSpacing,
              }
            );
            const testLine = currentLine + part;
            const testWidth = calculateSegmentWidth(
              font,
              testLine,
              metrics,
              fontSize,
              {
                letterSpacing,
              }
            );

            // Apply tolerance when checking if line would overflow
            // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
            if (currentLine && testWidth > maxWidth + wrapTolerance) {
              // Start new line with this part
              const positions = calculateGlyphPositions(
                font,
                currentLine,
                metrics,
                fontSize,
                {
                  letterSpacing,
                }
              );
              lines.push({
                characters: currentLine,
                positions,
                width: currentLineWidth,
                height: lineHeight,
                baseline: calculateBaselineFromLineHeight(
                  lineHeight,
                  metrics,
                  fontSize
                ),
              });

              currentLine = part;
              currentLineWidth = partWidth;
            } else {
              currentLine = testLine;
              currentLineWidth = testWidth;
            }
          }
          continue;
        }
      }

      // Try adding token to current line
      const testLine = currentLine + tokenContent;
      const testWidth = calculateSegmentWidth(
        font,
        testLine,
        metrics,
        fontSize,
        { letterSpacing }
      );

      // Apply tolerance when checking if line would overflow
      // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
      if (currentLine && testWidth > maxWidth + wrapTolerance) {
        // Current line would overflow - finalize it and start new line
        // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
        const positions = calculateGlyphPositions(
          font,
          currentLine,
          metrics,
          fontSize,
          {
            letterSpacing,
          }
        );
        lines.push({
          characters: currentLine,
          positions,
          width: currentLineWidth,
          height: lineHeight,
          baseline: calculateBaselineFromLineHeight(
            lineHeight,
            metrics,
            fontSize
          ),
        });

        // Start new line with current token (skip leading spaces)
        if (token.type === "space") {
          currentLine = "";
          currentLineWidth = 0;
        } else {
          currentLine = tokenContent;
          currentLineWidth = calculateSegmentWidth(
            font,
            tokenContent,
            metrics,
            fontSize,
            {
              letterSpacing,
            }
          );
        }
      } else {
        // Token fits on current line
        currentLine = testLine;
        currentLineWidth = testWidth;
      }
    }

    // Finalize last line
    // biome-ignore lint/nursery/noUnnecessaryConditions: false positive
    if (currentLine) {
      const positions = calculateGlyphPositions(
        font,
        currentLine,
        metrics,
        fontSize,
        {
          letterSpacing,
        }
      );
      lines.push({
        characters: currentLine,
        positions,
        width: currentLineWidth,
        height: lineHeight,
        baseline: calculateBaselineFromLineHeight(
          lineHeight,
          metrics,
          fontSize
        ),
      });
    }
  } else {
    const positions = calculateGlyphPositions(font, text, metrics, fontSize, {
      letterSpacing,
    });
    const width =
      positions.length > 0
        ? (positions.at(-1)?.x ?? 0) + (positions.at(-1)?.advance ?? 0)
        : 0;

    lines.push({
      characters: text,
      positions,
      width,
      height: lineHeight,
      baseline: calculateBaselineFromLineHeight(lineHeight, metrics, fontSize),
    });
  }

  // Calculate total dimensions
  const totalWidth = Math.max(...lines.map((line) => line.width));
  const totalHeight = lines.length * lineHeight;

  // Check for overflow (apply tolerance for horizontal overflow check)
  const overflow = {
    horizontal: maxWidth ? totalWidth > maxWidth + wrapTolerance : false,
    vertical: false, // DISABLED: No height clipping - let text wrap naturally and overflow if needed
    clippedText: undefined as string | undefined,
  };

  // DISABLED: No height clipping - let text wrap naturally and overflow if needed

  return {
    lines,
    totalWidth,
    totalHeight,
    overflow,
  };
}

/**
 * Apply horizontal alignment to each line individually in a multi-line layout
 *
 * @param layout - Multi-line layout to align
 * @param alignment - Horizontal alignment to apply
 * @param containerWidth - Container width for alignment calculations
 * @returns Multi-line layout with alignment applied to each line
 *
 * @example
 * ```typescript
 * const aligned = applyPerLineAlignment(multiLineLayout, 'center', 300);
 * ```
 */
export function applyPerLineAlignment(
  layout: MultiLineLayout,
  alignment: HorizontalAlignment,
  containerWidth?: number
): MultiLineLayout {
  if (alignment === "left" || !containerWidth) {
    return layout; // No alignment needed
  }

  const alignedLines = layout.lines.map((line) => {
    const xOffset = getHorizontalOffset(alignment, line.width, containerWidth);

    if (xOffset === 0) {
      return line; // No offset needed
    }

    const alignedPositions = line.positions.map((pos) => ({
      ...pos,
      x: pos.x + xOffset,
    }));

    return {
      ...line,
      positions: alignedPositions,
    };
  });

  const result = {
    ...layout,
    lines: alignedLines,
  };

  return result;
}

/**
 * Extract all glyph positions from multi-line layout
 *
 * @param layout - Multi-line layout to extract positions from
 * @returns Array of positioned glyphs with absolute coordinates
 *
 * @example
 * ```typescript
 * const positions = extractAllGlyphPositions(multiLineLayout);
 * console.log(`Total glyphs: ${positions.length}`);
 * ```
 */
export function extractAllGlyphPositions(
  layout: MultiLineLayout
): Array<GlyphPosition> {
  const flatPositions: Array<GlyphPosition> = [];

  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex += 1) {
    const line = layout.lines[lineIndex];
    if (!line) {
      continue;
    }

    // Each line should be positioned below the previous one
    const lineY = lineIndex * line.height;

    for (const pos of line.positions) {
      const finalY = lineY + line.baseline;

      flatPositions.push({
        ...pos,
        y: finalY, // Position relative to document, not line
      });
    }
  }

  return flatPositions;
}
