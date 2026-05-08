/**
 * Kerning Processing Primitives
 *
 * Resolves the kerning adjustment for a pair of glyphs by asking fontkit to
 * lay out the two-character string with shaping disabled. fontkit applies
 * both the legacy `kern` table and modern GPOS pair-adjustment lookups
 * automatically, so the kern delta is `position.xAdvance − glyph.advanceWidth`.
 */

import { fontUnitsToPixels } from "../../primitives/font/metrics";
import type { FontMetrics, OpenTypeFont, OpenTypeGlyph } from "../../types";

/**
 * Features we explicitly disable so the layout output is one glyph per code
 * point. Common-ligature features collapse pairs like "fi" into a single
 * glyph; contextual alternates and discretionary ligatures do similar things.
 * `kern` stays on (default) so the position deltas reflect kerning.
 */
const NO_SHAPING_FEATURES = {
  liga: false,
  dlig: false,
  clig: false,
  hlig: false,
  rlig: false,
  calt: false,
} as const;

/**
 * Kerning adjustment between two adjacent glyphs in pixels.
 *
 * Returns 0 when the pair is unknown to the font, when shaping unexpectedly
 * substituted the input (e.g. an unsupported script), or when fontkit throws.
 */
export function getKerning(
  font: OpenTypeFont,
  leftGlyph: OpenTypeGlyph,
  rightGlyph: OpenTypeGlyph,
  metrics: FontMetrics,
  fontSize: number
): number {
  try {
    const leftCp = leftGlyph.codePoints[0];
    const rightCp = rightGlyph.codePoints[0];
    if (leftCp === undefined || rightCp === undefined) {
      return 0;
    }

    const text = String.fromCodePoint(leftCp, rightCp);
    const run = font.layout(text, NO_SHAPING_FEATURES);

    // If shaping changed the glyph count we can't safely attribute the kern
    // delta to the left glyph; bail out.
    if (run.glyphs.length !== 2 || run.positions.length !== 2) {
      return 0;
    }

    const leftPosition = run.positions[0];
    const leftLaidGlyph = run.glyphs[0];
    if (!(leftPosition && leftLaidGlyph)) {
      return 0;
    }

    const kernUnits = leftPosition.xAdvance - leftLaidGlyph.advanceWidth;
    if (kernUnits === 0) {
      return 0;
    }

    return fontUnitsToPixels(kernUnits, fontSize, metrics.unitsPerEm);
  } catch {
    return 0;
  }
}
