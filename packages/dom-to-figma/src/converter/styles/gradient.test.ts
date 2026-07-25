import { describe, expect, it } from "vitest";
import type { FigmaPaint } from "../types";
import type { GradientBox } from "./gradient";
import { cssBackgroundToFigmaPaints } from "./gradient";

const BOX: GradientBox = { width: 200, height: 120 };

/** The single paint a gradient background is expected to produce. */
function paintFor(css: string, box: GradientBox = BOX): FigmaPaint {
  const [paint] = cssBackgroundToFigmaPaints(css, box);
  if (!paint) {
    throw new Error(`expected a paint for: ${css}`);
  }
  return paint;
}

/** Figma reads a linear gradient's progress off the first row of the transform. */
function progressAt(paint: FigmaPaint, x: number, y: number): number {
  const t = paint.transform;
  if (!t) {
    throw new Error("paint has no transform");
  }
  return t.m00 * x + t.m01 * y + t.m02;
}

function stopsOf(paint: FigmaPaint) {
  return "stops" in paint ? paint.stops : [];
}

describe("cssBackgroundToFigmaPaints()", () => {
  it("returns nothing for empty or `none` backgrounds", () => {
    expect(cssBackgroundToFigmaPaints("")).toEqual([]);
    expect(cssBackgroundToFigmaPaints("none")).toEqual([]);
  });

  it("ignores backgrounds that are not gradients", () => {
    expect(cssBackgroundToFigmaPaints("url(cat.png)")).toEqual([]);
  });

  describe("linear gradients", () => {
    it("ramps top-to-bottom by default", () => {
      const paint = paintFor("linear-gradient(#6366f1, #f59e0b)");

      expect(paint.type).toBe("GRADIENT_LINEAR");
      expect(progressAt(paint, 0, 0)).toBeCloseTo(0);
      expect(progressAt(paint, 0, 1)).toBeCloseTo(1);
    });

    // Regression: the x term used to carry the wrong sign, which mirrored every
    // angled gradient. 0deg/180deg hid it because their x term is zero.
    it("ramps left-to-right for `to right`", () => {
      const paint = paintFor("linear-gradient(to right, #6366f1, #f59e0b)");

      expect(progressAt(paint, 0, 0.5)).toBeCloseTo(0);
      expect(progressAt(paint, 1, 0.5)).toBeCloseTo(1);
    });

    it("puts 45deg's first stop at the bottom-left corner", () => {
      const paint = paintFor("linear-gradient(45deg, #6366f1, #f59e0b)");

      // CSS 45deg points to the top-right, so the ramp runs corner to corner.
      expect(progressAt(paint, 0, 1)).toBeCloseTo(0);
      expect(progressAt(paint, 1, 0)).toBeCloseTo(1);
      expect(progressAt(paint, 0.5, 0.5)).toBeCloseTo(0.5);
    });

    it("scales the gradient line to the box, not to a square", () => {
      const wide = paintFor("linear-gradient(45deg, #000, #fff)", {
        width: 400,
        height: 100,
      });

      // A wide box tips the 45deg ramp towards the horizontal axis.
      expect(wide.transform?.m00).toBeCloseTo(0.8);
      expect(wide.transform?.m01).toBeCloseTo(-0.2);
      expect(progressAt(wide, 0, 1)).toBeCloseTo(0);
      expect(progressAt(wide, 1, 0)).toBeCloseTo(1);
    });

    it("keeps the stop colours and order", () => {
      const paint = paintFor("linear-gradient(#000000, #ffffff)");

      expect(stopsOf(paint)).toMatchObject([
        { position: 0, color: { r: 0, g: 0, b: 0 } },
        { position: 1, color: { r: 1, g: 1, b: 1 } },
      ]);
    });
  });

  describe("radial gradients", () => {
    it("builds a radial paint instead of dropping the fill", () => {
      const paint = paintFor("radial-gradient(#6366f1, #f59e0b)");

      expect(paint.type).toBe("GRADIENT_RADIAL");
      expect(stopsOf(paint)).toHaveLength(2);
    });

    it("centres the gradient", () => {
      const paint = paintFor("radial-gradient(#000, #fff)");

      // The centre of the box sits at the centre of gradient space.
      expect(progressAt(paint, 0.5, 0.5)).toBeCloseTo(0.5);
    });

    it("skips a leading geometry argument rather than reading it as a colour", () => {
      for (const geometry of [
        "circle",
        "ellipse at center",
        "farthest-corner at 20% 30%",
        "closest-side",
      ]) {
        const paint = paintFor(`radial-gradient(${geometry}, #000, #fff)`);

        expect(paint.type).toBe("GRADIENT_RADIAL");
        expect(stopsOf(paint)).toHaveLength(2);
      }
    });
  });
});
