/**
 * Font Subset Selection
 *
 * Google Fonts (and therefore fontsource) ships one `.woff2` per script
 * subset: `latin`, `latin-ext`, `cyrillic`, `greek`, `vietnamese`, … The
 * `latin` file carries no Cyrillic or Greek glyphs at all, so laying out
 * "Привет" against it yields `.notdef` for every character — the text
 * measures wrong and paints blank in Figma.
 *
 * This module picks the subset that covers the most characters of a given
 * run, so the converter asks for a file that actually contains the glyphs.
 *
 * @module FontSubsetPrimitives
 */

/** The fontsource subset a run should be laid out against. */
export const DEFAULT_FONT_SUBSET = "latin";

type SubsetRange = readonly [start: number, end: number];

type SubsetDefinition = {
  name: string;
  ranges: ReadonlyArray<SubsetRange>;
};

/**
 * Codepoint ranges per subset, mirroring the `unicode-range` descriptors
 * Google Fonts publishes. Only the scripts fontsource splits out are listed;
 * anything not matched here falls through to `latin`.
 *
 * Ordered most-specific first: `vietnamese` overlaps `latin-ext`, and
 * `*-ext` subsets are supersets of their base, so the first match wins.
 */
const SUBSETS: ReadonlyArray<SubsetDefinition> = [
  {
    name: "vietnamese",
    ranges: [
      [0x01_02, 0x01_03],
      [0x01_10, 0x01_11],
      [0x01_28, 0x01_29],
      [0x01_68, 0x01_69],
      [0x01_a0, 0x01_a1],
      [0x01_af, 0x01_b0],
      [0x1e_a0, 0x1e_f9],
      [0x20_ab, 0x20_ab],
    ],
  },
  {
    name: "cyrillic-ext",
    ranges: [
      [0x04_60, 0x05_2f],
      [0x2d_e0, 0x2d_ff],
      [0xa6_40, 0xa6_9f],
    ],
  },
  {
    name: "cyrillic",
    ranges: [
      [0x03_01, 0x03_01],
      [0x04_00, 0x04_5f],
      [0x04_90, 0x04_91],
      [0x04_b0, 0x04_b3],
      [0x21_16, 0x21_16],
    ],
  },
  {
    name: "greek-ext",
    ranges: [[0x1f_00, 0x1f_ff]],
  },
  {
    name: "greek",
    ranges: [[0x03_70, 0x03_ff]],
  },
  {
    name: "latin-ext",
    ranges: [
      [0x01_00, 0x02_af],
      [0x03_04, 0x03_04],
      [0x03_08, 0x03_08],
      [0x03_29, 0x03_29],
      [0x1e_00, 0x1e_9f],
      [0x1e_f2, 0x1e_ff],
      [0x20_20, 0x20_20],
      [0x20_e0, 0x20_e0],
      [0xa7_20, 0xa7_ff],
    ],
  },
];

function inRanges(codepoint: number, ranges: ReadonlyArray<SubsetRange>) {
  return ranges.some(([start, end]) => codepoint >= start && codepoint <= end);
}

/**
 * Pick the fontsource subset that covers the most characters of `text`.
 *
 * A run written entirely in one script resolves to that script's subset;
 * plain ASCII (and anything we don't split out, emoji included) stays on
 * `latin`. A run genuinely mixing scripts can only get one file — the
 * majority script wins, since no single fontsource `.woff2` spans two.
 *
 * @example
 * ```typescript
 * detectFontSubset("Hello"); // "latin"
 * detectFontSubset("Привет"); // "cyrillic"
 * ```
 */
export function detectFontSubset(text: string): string {
  const counts = new Map<string, number>();

  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) {
      continue;
    }
    const subset = SUBSETS.find((candidate) =>
      inRanges(codepoint, candidate.ranges)
    );
    if (subset) {
      counts.set(subset.name, (counts.get(subset.name) ?? 0) + 1);
    }
  }

  let best = DEFAULT_FONT_SUBSET;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }

  return best;
}
