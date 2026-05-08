/**
 * Glyph Processing Primitives
 *
 * Low-level glyph processing operations for converting text characters
 * to Figma-compatible glyph data with proper metrics and positioning.
 *
 * @module GlyphProcessorPrimitives
 */

import type { FigmaBlob, OpenTypeFont, OpenTypeGlyph } from "../../types";
import type { FontMetrics, LoadedFont } from "../font";
import { pathCommandsToGlyphBytes } from "./encoder";

/**
 * Processed glyph data with path and byte information.
 *
 * Complete glyph representation ready for Figma text node construction.
 */
export type GlyphData = {
  /** The character this glyph represents */
  character: string;
  /** Unicode code point */
  unicode: number;
  /** Encoded byte data for Figma blob registration */
  bytes: Array<number>;
  /** Advance width in pixels */
  advance: number;
  /** Registered blob index from registerBlob function */
  registeredBlobIndex: number;
};

/**
 * Collection of processed glyphs with registered blob indices
 *
 * Maps characters to their complete glyph data, including blob registrations
 * ready for use in Figma text node construction.
 */
export type ProcessedGlyphs = {
  /** Map of character to glyph data with registered blob indices */
  glyphDataMap: Map<string, GlyphData>;
};

/**
 * Glyph processing options
 */
export type GlyphProcessingOptions = {
  /** Font size in pixels for advance width calculation */
  fontSize: number;
  /** Whether to process whitespace characters */
  includeWhitespace?: boolean;
  /** Custom character substitutions */
  characterSubstitutions?: Map<string, string>;
};

/**
 * Extract and process glyphs for a given text string
 *
 * Processes all unique characters in the text string, generating complete
 * glyph data including SVG paths, encoded bytes, and registered blob indices.
 * Handles special characters like spaces and missing glyphs gracefully.
 *
 * @param loadedFont - Font with metrics and OpenType data
 * @param text - Text to process for glyph extraction
 * @param options - Processing options including font size
 * @param registerBlob - Function to register blob data and get index
 * @returns Processed glyph data with registered blob indices
 *
 * @example
 * ```typescript
 * const processed = processGlyphs(loadedFont, "Hello World!", {
 *   fontSize: 16,
 *   includeWhitespace: true
 * }, registerBlob);
 *
 * console.log(`Processed ${processed.glyphDataMap.size} unique glyphs`);
 * // Access specific glyph data
 * const hGlyph = processed.glyphDataMap.get('H');
 * ```
 */
export function processGlyphs(
  loadedFont: LoadedFont,
  text: string,
  options: GlyphProcessingOptions,
  registerBlob: (blob: FigmaBlob) => number
): ProcessedGlyphs {
  const { font, metrics } = loadedFont;
  const {
    fontSize,
    includeWhitespace = true,
    characterSubstitutions,
  } = options;

  // Get unique characters, applying substitutions if provided
  const processedText = applyCharacterSubstitutions(
    text,
    characterSubstitutions
  );
  const uniqueChars = [...new Set(processedText)];

  const glyphDataMap = new Map<string, GlyphData>();

  // Process each unique character and register its blob
  for (const char of uniqueChars) {
    // Skip whitespace if not requested
    if (!includeWhitespace && /\s/.test(char)) {
      continue;
    }

    const glyphData = processSingleGlyph(
      font,
      char,
      metrics,
      fontSize,
      registerBlob
    );
    if (glyphData) {
      glyphDataMap.set(char, glyphData);
    }
  }

  return { glyphDataMap };
}

/**
 * Process a single character into complete glyph data
 *
 * Handles the complete pipeline for a single character:
 * 1. Maps character to font glyph
 * 2. Generates SVG path data
 * 3. Encodes to Figma-compatible bytes
 * 4. Registers blob and stores index
 * 5. Calculates metrics and advance width
 *
 * @param font - OpenType.js font object
 * @param char - Character to process
 * @param metrics - Font metrics for calculations
 * @param fontSize - Font size in pixels for advance width
 * @param registerBlob - Function to register blob data and get index
 * @returns Processed glyph data or null if character not supported
 *
 * @example
 * ```typescript
 * const glyphData = processSingleGlyph(font, 'A', metrics, 16, registerBlob);
 * if (glyphData) {
 *   console.log(`Advance width: ${glyphData.advance}px`);
 * }
 * ```
 */
function processSingleGlyph(
  font: OpenTypeFont,
  char: string,
  metrics: FontMetrics,
  fontSize: number,
  registerBlob: (blob: FigmaBlob) => number
): GlyphData | null {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return null;
  }
  const glyph = font.glyphForCodePoint(codePoint);

  // glyph.id 0 is the .notdef glyph for unmapped characters. Treat space as a
  // valid glyph even when the cmap returns .notdef, since we substitute a
  // minimal blob for it anyway.
  if (glyph.id === 0 && char !== " ") {
    console.warn(
      `No glyph found for character: '${char}' (U+${codePoint.toString(16).toUpperCase()})`
    );
    return null;
  }

  if (char === " ") {
    return createSpaceGlyph(
      char,
      glyph,
      fontSize,
      metrics.unitsPerEm,
      registerBlob
    );
  }

  const glyphBytes = pathCommandsToGlyphBytes(glyph.path.commands, {
    unitsPerEm: metrics.unitsPerEm,
  });

  if (glyphBytes.length <= 1) {
    // Path was empty (only the close opcode) — skip rather than emit a noop.
    console.warn(`Empty path for character: '${char}'`);
    return null;
  }

  const registeredBlobIndex = registerBlob({ bytes: glyphBytes });
  const advance = calculateAdvanceWidth(glyph, fontSize, metrics.unitsPerEm);

  return {
    character: char,
    unicode: codePoint,
    bytes: glyphBytes,
    advance,
    registeredBlobIndex,
  };
}

/**
 * Create glyph data for space character.
 *
 * Spaces don't have visible paths but need a proper advance width and a
 * minimal blob (the lone close opcode) so Figma can render text runs.
 */
function createSpaceGlyph(
  char: string,
  glyph: OpenTypeGlyph,
  fontSize: number,
  unitsPerEm: number,
  registerBlob: (blob: FigmaBlob) => number
): GlyphData {
  const spaceBytes = [0]; // close command only
  const registeredBlobIndex = registerBlob({ bytes: spaceBytes });
  const advance = calculateAdvanceWidth(glyph, fontSize, unitsPerEm);

  return {
    character: char,
    unicode: char.codePointAt(0) ?? 0,
    bytes: spaceBytes,
    advance,
    registeredBlobIndex,
  };
}

/**
 * Calculate advance width in pixels for a glyph
 *
 * Converts font unit advance width to pixel units at the specified font size.
 * Handles cases where advance width might be undefined.
 *
 * @param glyph - OpenType glyph object
 * @param fontSize - Font size in pixels
 * @param unitsPerEm - Font's units per EM value
 * @returns Advance width in pixels
 *
 * @internal
 */
function calculateAdvanceWidth(
  glyph: OpenTypeGlyph,
  fontSize: number,
  unitsPerEm: number
): number {
  const advanceWidth = glyph.advanceWidth ?? 0;
  return (advanceWidth / unitsPerEm) * fontSize;
}

/**
 * Apply character substitutions to text
 *
 * Handles character-level replacements before glyph processing.
 * Useful for font fallbacks or special character handling.
 *
 * @param text - Original text
 * @param substitutions - Optional character substitution map
 * @returns Text with substitutions applied
 *
 * @internal
 */
function applyCharacterSubstitutions(
  text: string,
  substitutions?: Map<string, string>
): string {
  if (!substitutions) {
    return text;
  }

  let result = text;
  for (const [from, to] of substitutions) {
    result = result.replace(new RegExp(from, "g"), to);
  }

  return result;
}
