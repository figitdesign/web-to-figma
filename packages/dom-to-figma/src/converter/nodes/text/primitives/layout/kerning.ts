/**
 * Kerning Processing Primitives
 *
 * Resolves per-pair kerning deltas by asking fontkit to lay out the entire
 * text run with shaping disabled. fontkit applies both the legacy `kern`
 * table and modern GPOS pair-adjustment lookups automatically, so the kern
 * delta between glyphs i and i+1 is `position[i].xAdvance − glyph[i].advanceWidth`.
 *
 * One layout call per run replaces what used to be N pairwise calls.
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
 * Compute per-pair kerning deltas (in pixels) for a text run.
 *
 * Returns an array of length `max(0, glyphs.length - 1)` where index `i` holds
 * the kerning between `glyphs[i]` and `glyphs[i + 1]`. Falls back to all
 * zeros if shaping unexpectedly substituted the input (e.g. unsupported
 * script) or fontkit throws.
 */
export function computeKernings(
  font: OpenTypeFont,
  text: string,
  glyphs: ReadonlyArray<OpenTypeGlyph>,
  metrics: FontMetrics,
  fontSize: number
): Array<number> {
  const result = new Array<number>(Math.max(0, glyphs.length - 1)).fill(0);
  if (glyphs.length < 2) {
    return result;
  }

  try {
    const run = font.layout(text, NO_SHAPING_FEATURES);
    // If shaping merged or split clusters, the per-character contract is
    // broken; fall back to no kerning rather than misattributing deltas.
    if (run.glyphs.length !== glyphs.length) {
      return result;
    }
    for (let i = 0; i < run.glyphs.length - 1; i += 1) {
      const laidGlyph = run.glyphs[i];
      const laidPos = run.positions[i];
      if (!(laidGlyph && laidPos)) {
        continue;
      }
      const kernUnits = laidPos.xAdvance - laidGlyph.advanceWidth;
      if (kernUnits === 0) {
        continue;
      }
      result[i] = fontUnitsToPixels(kernUnits, fontSize, metrics.unitsPerEm);
    }
  } catch {
    /* fall through to zeros */
  }

  return result;
}
