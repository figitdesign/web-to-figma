/**
 * CSS Parsing Primitives
 *
 * Low-level CSS property parsing and normalization utilities.
 * Handles extraction and conversion of CSS properties relevant to text rendering.
 *
 * @module CSSParserPrimitives
 */

import type { FontProperties } from "../font/properties";
import { parseFontProperties } from "../font/properties";

/**
 * CSS line-height value parsing options
 */
type LineHeightOptions = {
  /** Font size in pixels for relative calculations */
  fontSize: number;
  /** Root font size in pixels for rem calculations (defaults to 16px) */
  rootFontSize?: number;
};

/**
 * Parsed CSS properties relevant to text rendering
 */
export type ParsedTextProperties = {
  /** Font properties (family, weight, style) */
  font: FontProperties;
  /** Font size in pixels */
  fontSize: number;
  /** Line height in pixels */
  lineHeight: number;
  /** Letter spacing in pixels */
  letterSpacing: number;
  /** Word spacing in pixels */
  wordSpacing: number;
  /** Text alignment */
  textAlign: "left" | "center" | "right";
  /** Text color (CSS color value) */
  color: string;
  /** Element dimensions */
  dimensions: {
    width: number;
    height: number;
  };
};

/**
 * Parse all text-relevant CSS properties from an HTML element
 *
 * Extracts computed styles and normalizes them to a consistent format
 * suitable for text processing. Handles fallbacks and edge cases.
 *
 * @param element - HTML element to parse
 * @returns Parsed and normalized text properties
 *
 * @example
 * ```typescript
 * const props = parseTextProperties(textElement);
 * console.log(`Font: ${props.font.family} ${props.font.weight}`);
 * console.log(`Size: ${props.fontSize}px, Line height: ${props.lineHeight}px`);
 * ```
 */
export function parseTextProperties(element: Element): ParsedTextProperties {
  const computedStyle = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  // Parse font size first (needed for relative calculations)
  const fontSize = parseFontSize(computedStyle.fontSize);

  // Parse font properties
  const font = parseFontProperties(
    computedStyle.fontFamily,
    computedStyle.fontWeight,
    computedStyle.fontStyle
  );

  // Parse line height (depends on font size)
  const lineHeight = parseLineHeight(computedStyle.lineHeight, { fontSize });

  // Parse spacing properties
  const letterSpacing = parseLetterSpacing(computedStyle.letterSpacing);
  const wordSpacing = parseWordSpacing(computedStyle.wordSpacing);

  // Parse alignment
  const textAlign = parseTextAlign(computedStyle.textAlign);

  // Get color
  const color = computedStyle.color || "rgb(0, 0, 0)";

  return {
    font,
    fontSize,
    lineHeight,
    letterSpacing,
    wordSpacing,
    textAlign,
    color,
    dimensions: {
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    },
  };
}

/**
 * Parse CSS font-size value to pixels
 *
 * Converts various CSS font-size formats to pixel values.
 * Handles px, em, rem, %, and keyword values.
 *
 * @param fontSizeValue - CSS font-size value
 * @param baseFontSize - Base font size for relative calculations (defaults to 16px)
 * @returns Font size in pixels
 *
 * @example
 * ```typescript
 * parseFontSize('24px');      // 24
 * parseFontSize('1.5em', 16); // 24
 * parseFontSize('150%', 16);  // 24
 * parseFontSize('large');     // 18
 * ```
 */
function parseFontSize(fontSizeValue: string, baseFontSize = 16): number {
  if (!fontSizeValue || fontSizeValue.trim() === "") {
    return 16; // Default font size
  }

  const value = fontSizeValue.trim();

  // Handle pixel values
  const pxMatch = /^(\d*\.?\d+)px$/.exec(value);
  if (pxMatch) {
    return pxMatch[1] ? Number.parseFloat(pxMatch[1]) : 16;
  }

  // Handle em values
  const emMatch = /^(\d*\.?\d+)em$/.exec(value);
  if (emMatch) {
    return (Number.parseFloat(emMatch[1] ?? "1") || 1) * baseFontSize;
  }

  // Handle rem values
  const remMatch = /^(\d*\.?\d+)rem$/.exec(value);
  if (remMatch) {
    return (Number.parseFloat(remMatch[1] ?? "1") || 1) * 16; // rem is always relative to root (16px default)
  }

  // Handle percentage values
  const percentMatch = /^(\d*\.?\d+)%$/.exec(value);
  if (percentMatch) {
    return (
      ((Number.parseFloat(percentMatch[1] ?? "100") || 100) / 100) *
      baseFontSize
    );
  }

  // Handle keyword values
  const keywordSizes: Record<string, number> = {
    "xx-small": 9,
    "x-small": 10,
    small: 13,
    medium: 16,
    large: 18,
    "x-large": 24,
    "xx-large": 32,
    smaller: baseFontSize * 0.85,
    larger: baseFontSize * 1.2,
  };

  if (value in keywordSizes && keywordSizes[value]) {
    return keywordSizes[value];
  }

  // Try to parse as a number
  const numValue = Number.parseFloat(value);
  if (!Number.isNaN(numValue) && numValue > 0) {
    return numValue;
  }

  // Fallback
  return 16;
}

/**
 * Parse CSS line-height value to pixels
 *
 * Handles all CSS line-height formats: unitless numbers, pixels,
 * percentages, keywords, em/rem values.
 *
 * @param lineHeightValue - CSS line-height value
 * @param options - Parsing options including font size
 * @returns Line height in pixels
 *
 * @example
 * ```typescript
 * parseLineHeight('1.5', { fontSize: 16 });     // 24
 * parseLineHeight('24px', { fontSize: 16 });    // 24
 * parseLineHeight('150%', { fontSize: 16 });    // 24
 * parseLineHeight('normal', { fontSize: 16 });  // 19.2
 * ```
 */
function parseLineHeight(
  lineHeightValue: string,
  options: LineHeightOptions
): number {
  const { fontSize, rootFontSize = 16 } = options;

  if (!lineHeightValue || lineHeightValue.trim() === "") {
    return fontSize * 1.2; // Default line height
  }

  const value = lineHeightValue.trim();

  // Handle "normal" keyword - typically 1.2x font size
  if (value === "normal") {
    return fontSize * 1.2;
  }

  // Handle unitless numbers (multipliers)
  const unitlessMatch = /^(\d*\.?\d+)$/.exec(value);
  if (unitlessMatch) {
    const multiplier = unitlessMatch[1]
      ? Number.parseFloat(unitlessMatch[1])
      : 1;
    if (!Number.isNaN(multiplier)) {
      return fontSize * multiplier;
    }
  }

  // Handle pixels
  const pxMatch = /^(\d*\.?\d+)px$/.exec(value);
  if (pxMatch) {
    const pixels = pxMatch[1] ? Number.parseFloat(pxMatch[1]) : 1;
    if (!Number.isNaN(pixels)) {
      return pixels;
    }
  }

  // Handle percentages
  const percentMatch = /^(\d*\.?\d+)%$/.exec(value);
  if (percentMatch) {
    const percent = percentMatch[1] ? Number.parseFloat(percentMatch[1]) : 1;
    if (!Number.isNaN(percent)) {
      return fontSize * (percent / 100);
    }
  }

  // Handle em units
  const emMatch = /^(\d*\.?\d+)em$/.exec(value);
  if (emMatch) {
    const emValue = emMatch[1] ? Number.parseFloat(emMatch[1]) : 1;
    if (!Number.isNaN(emValue)) {
      return fontSize * emValue;
    }
  }

  // Handle rem units
  const remMatch = /^(\d*\.?\d+)rem$/.exec(value);
  if (remMatch) {
    const remValue = remMatch[1] ? Number.parseFloat(remMatch[1]) : 1;
    if (!Number.isNaN(remValue)) {
      return rootFontSize * remValue;
    }
  }

  // Fallback: try to parse as a number and use as multiplier
  const fallbackNumber = Number.parseFloat(value);
  if (!Number.isNaN(fallbackNumber)) {
    return fontSize * fallbackNumber;
  }

  // Final fallback: return normal line height
  return fontSize * 1.2;
}

/**
 * Parse CSS letter-spacing value to pixels
 *
 * @param letterSpacingValue - CSS letter-spacing value
 * @returns Letter spacing in pixels
 */
function parseLetterSpacing(letterSpacingValue: string): number {
  if (!letterSpacingValue || letterSpacingValue === "normal") {
    return 0;
  }

  const pxMatch = /^(-?\d*\.?\d+)px$/.exec(letterSpacingValue);
  if (pxMatch) {
    return pxMatch[1] ? Number.parseFloat(pxMatch[1]) : 0;
  }

  // Handle em values (would need font size, but we'll approximate)
  const emMatch = /^(-?\d*\.?\d+)em$/.exec(letterSpacingValue);
  if (emMatch) {
    return (emMatch[1] ? Number.parseFloat(emMatch[1]) : 0) * 16; // Approximate with 16px base
  }

  return 0;
}

/**
 * Parse CSS word-spacing value to pixels
 *
 * @param wordSpacingValue - CSS word-spacing value
 * @returns Word spacing in pixels
 */
function parseWordSpacing(wordSpacingValue: string): number {
  if (!wordSpacingValue || wordSpacingValue === "normal") {
    return 0;
  }

  const pxMatch = /^(-?\d*\.?\d+)px$/.exec(wordSpacingValue);
  if (pxMatch) {
    return pxMatch[1] ? Number.parseFloat(pxMatch[1]) : 0;
  }

  // Handle em values
  const emMatch = /^(-?\d*\.?\d+)em$/.exec(wordSpacingValue);
  if (emMatch) {
    return (emMatch[1] ? Number.parseFloat(emMatch[1]) : 0) * 16; // Approximate with 16px base
  }

  return 0;
}

/**
 * Parse CSS text-align value
 *
 * @param textAlignValue - CSS text-align value
 * @returns Normalized text alignment
 */
function parseTextAlign(textAlignValue: string): "left" | "center" | "right" {
  if (!textAlignValue) {
    return "left";
  }

  switch (textAlignValue.toLowerCase().trim()) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    default:
      return "left";
  }
}
