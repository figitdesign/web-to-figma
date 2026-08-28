/**
 * OpenType Feature Primitives
 *
 * CSS can switch on OpenType features that change which glyph a character
 * maps to — `font-variant-numeric: tabular-nums` swaps Inter's proportional
 * figures for tabular ones, which are ~8% wider. Laying the run out against
 * the default glyphs then measures the wrong advances and paints the wrong
 * shapes, so the converter resolves glyphs through the requested features.
 *
 * @module FontFeaturePrimitives
 */

import type { OpenTypeFont, OpenTypeGlyph } from "../../types";

/** OpenType feature tags to enable for a run, e.g. `["tnum"]`. */
export type OpenTypeFeatures = ReadonlyArray<string>;

/** `font-variant-numeric` keyword → OpenType feature tag. */
const NUMERIC_KEYWORD_TO_TAG: Record<string, string> = {
  "lining-nums": "lnum",
  "oldstyle-nums": "onum",
  "proportional-nums": "pnum",
  "tabular-nums": "tnum",
  "diagonal-fractions": "frac",
  "stacked-fractions": "afrc",
  ordinal: "ordn",
  "slashed-zero": "zero",
};

// `font-feature-settings` entries look like `"tnum" 1`, `'tnum' on`, or just
// `"tnum"`. A trailing `0`/`off` disables the feature.
const FEATURE_SETTING = /^["']([a-z0-9]{4})["'](?:\s+(?<value>on|off|\d+))?$/iu;

/**
 * Read the OpenType features a computed style asks for.
 *
 * Covers `font-variant-numeric` and `font-feature-settings`; the remaining
 * `font-variant-*` longhands map to features that don't change advances for
 * the scripts we lay out, so they are left to the font's defaults.
 *
 * @example
 * ```typescript
 * parseFontFeatures(style); // ["tnum"] for `font-variant-numeric: tabular-nums`
 * ```
 */
export function parseFontFeatures(
  style: CSSStyleDeclaration
): OpenTypeFeatures {
  const tags = new Set<string>();

  for (const keyword of splitTokens(style.fontVariantNumeric)) {
    const tag = NUMERIC_KEYWORD_TO_TAG[keyword];
    if (tag) {
      tags.add(tag);
    }
  }

  for (const setting of splitList(style.fontFeatureSettings)) {
    const match = FEATURE_SETTING.exec(setting);
    const tag = match?.[1];
    if (!tag) {
      continue;
    }
    const value = match?.groups?.value?.toLowerCase();
    if (value === "off" || value === "0") {
      tags.delete(tag.toLowerCase());
    } else {
      tags.add(tag.toLowerCase());
    }
  }

  return [...tags];
}

function splitTokens(value: string | undefined): Array<string> {
  if (!value || value === "normal") {
    return [];
  }
  return value.trim().toLowerCase().split(/\s+/);
}

function splitList(value: string | undefined): Array<string> {
  if (!value || value === "normal") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Map a character to its glyph, honouring the run's OpenType features.
 *
 * The rest of the pipeline is keyed by character, so shaping that merges or
 * splits clusters would corrupt it. Only a clean 1:1 substitution is taken;
 * anything else falls back to the cmap lookup.
 */
export function glyphForCharacter(
  font: OpenTypeFont,
  codePoint: number,
  features: OpenTypeFeatures
): OpenTypeGlyph {
  const fallback = font.glyphForCodePoint(codePoint);
  if (features.length === 0) {
    return fallback;
  }
  try {
    const run = font.layout(String.fromCodePoint(codePoint), [...features]);
    const substituted = run.glyphs[0];
    if (run.glyphs.length === 1 && substituted) {
      return substituted;
    }
  } catch {
    /* fall through to the cmap glyph */
  }
  return fallback;
}
