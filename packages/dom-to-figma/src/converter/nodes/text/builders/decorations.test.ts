import { describe, expect, it } from "vitest";
import type { FontMetrics, ProcessedTextLayout } from "../types";
import { parseDecorationLines, processTextDecorations } from "./decorations";

const FONT_SIZE = 26;

// Inter-like metrics: 2048 units/em, ascender ≈ 0.969em, x-height ≈ 0.546em.
const METRICS: FontMetrics = {
  unitsPerEm: 2048,
  ascender: 1984,
  descender: -494,
  lineGap: 0,
  capHeight: 1490,
  xHeight: 1118,
  underlineThickness: 140,
  lineHeight: 2478,
  lineHeightRatio: 2478 / 2048,
  baseline: 494,
  familyName: "Inter",
  styleName: "Regular",
};

/** A single laid-out line of "Ab" with its baseline at y = 24. */
function singleLineLayout(): ProcessedTextLayout {
  const positions = [
    { character: "A", x: 10, y: 24, advance: 16, glyphIndex: 1 },
    { character: "b", x: 26, y: 24, advance: 14, glyphIndex: 2 },
  ];
  return {
    positions,
    bounds: { x: 0, y: 0, width: 30, height: 32 },
    baseline: 24,
    metrics: METRICS,
    textWidth: 30,
    glyphCount: 2,
    options: { fontSize: FONT_SIZE },
    isMultiLine: true,
    multiLineLayout: {
      lines: [
        {
          characters: "Ab",
          positions,
          width: 30,
          height: 32,
          baseline: 24,
        },
      ],
      totalWidth: 30,
      totalHeight: 32,
      overflow: { horizontal: false, vertical: false },
    },
  };
}

describe("parseDecorationLines()", () => {
  it("returns nothing for `none`", () => {
    expect(parseDecorationLines("none")).toEqual([]);
  });

  it("reads each supported keyword", () => {
    expect(parseDecorationLines("underline")).toEqual(["underline"]);
    expect(parseDecorationLines("line-through")).toEqual(["line-through"]);
    expect(parseDecorationLines("overline")).toEqual(["overline"]);
  });

  it("reads a combined value", () => {
    expect(parseDecorationLines("underline line-through")).toEqual([
      "underline",
      "line-through",
    ]);
  });

  it("drops keywords we cannot draw", () => {
    expect(parseDecorationLines("blink underline")).toEqual(["underline"]);
  });
});

describe("processTextDecorations()", () => {
  it("draws nothing when no line is requested", () => {
    expect(
      processTextDecorations(singleLineLayout(), {
        lines: [],
        fontSize: FONT_SIZE,
      })
    ).toEqual([]);
  });

  it("puts the underline just below the baseline", () => {
    const [underline] = processTextDecorations(singleLineLayout(), {
      lines: ["underline"],
      fontSize: FONT_SIZE,
    });
    const rect = underline?.rects[0];
    expect(rect?.x).toBe(10);
    expect(rect?.w).toBe(30);
    expect(rect?.y).toBeCloseTo(24 + FONT_SIZE * 0.086, 5);
  });

  it("centres the line-through on half the cap height", () => {
    const [strike] = processTextDecorations(singleLineLayout(), {
      lines: ["line-through"],
      fontSize: FONT_SIZE,
    });
    const rect = strike?.rects[0];
    const capHeightPx = (METRICS.capHeight / METRICS.unitsPerEm) * FONT_SIZE;
    // Rect centre sits at baseline − capHeight / 2.
    expect((rect?.y ?? 0) + (rect?.h ?? 0) / 2).toBeCloseTo(
      24 - capHeightPx / 2,
      5
    );
  });

  it("rests the overline's underside on the ascender", () => {
    const [overline] = processTextDecorations(singleLineLayout(), {
      lines: ["overline"],
      fontSize: FONT_SIZE,
    });
    const ascenderPx = (METRICS.ascender / METRICS.unitsPerEm) * FONT_SIZE;
    const rect = overline?.rects[0];
    expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeCloseTo(24 - ascenderPx, 5);
  });

  it("draws one decoration per requested line", () => {
    const decorations = processTextDecorations(singleLineLayout(), {
      lines: ["underline", "line-through"],
      fontSize: FONT_SIZE,
    });
    expect(decorations).toHaveLength(2);
    expect(decorations[0]?.rects[0]?.y).toBeGreaterThan(24);
    expect(decorations[1]?.rects[0]?.y).toBeLessThan(24);
  });

  it("draws the rule at the font's own thickness", () => {
    const [underline] = processTextDecorations(singleLineLayout(), {
      lines: ["underline"],
      fontSize: FONT_SIZE,
    });
    expect(underline?.rects[0]?.h).toBeCloseTo(
      (METRICS.underlineThickness / METRICS.unitsPerEm) * FONT_SIZE,
      5
    );
  });

  it("draws one rect per wrapped line", () => {
    const layout = singleLineLayout();
    const secondLinePositions = [
      { character: "C", x: 10, y: 56, advance: 15, glyphIndex: 3 },
    ];
    layout.positions.push(...secondLinePositions);
    layout.multiLineLayout?.lines.push({
      characters: "C",
      positions: secondLinePositions,
      width: 15,
      height: 32,
      baseline: 56,
    });

    const [overline] = processTextDecorations(layout, {
      lines: ["overline"],
      fontSize: FONT_SIZE,
    });
    expect(overline?.rects).toHaveLength(2);
    expect(overline?.rects[1]?.w).toBe(15);
    expect((overline?.rects[1]?.y ?? 0) - (overline?.rects[0]?.y ?? 0)).toBe(
      32
    );
  });
});
