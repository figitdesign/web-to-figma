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

  describe("pixel stop offsets", () => {
    it("places a px stop along the gradient line, not at an even split", () => {
      // Default 180deg on a 120px-tall box: 30px is a quarter of the line.
      const paint = paintFor("linear-gradient(#000 0px, #fff 30px)");

      expect(stopsOf(paint)[0]?.position).toBeCloseTo(0, 6);
      expect(stopsOf(paint)[1]?.position).toBeCloseTo(0.25, 6);
    });

    it("measures a radial px stop against the horizontal radius", () => {
      // farthest-corner radius is (√2/2)·200 ≈ 141.42px.
      const paint = paintFor("radial-gradient(#000 0px, #fff 70.71px)");

      expect(stopsOf(paint)[1]?.position).toBeCloseTo(0.5, 3);
    });
  });

  describe("conic gradients", () => {
    it("builds an angular paint instead of dropping the fill", () => {
      const paint = paintFor("conic-gradient(#6366f1, #f59e0b)");

      expect(paint.type).toBe("GRADIENT_ANGULAR");
      expect(stopsOf(paint).map((stop) => stop.position)).toEqual([0, 1]);
    });

    it("reads stop offsets as fractions of a turn", () => {
      const paint = paintFor("conic-gradient(#000 0deg, #fff 90deg)");

      expect(stopsOf(paint).map((stop) => stop.position)).toEqual([0, 0.25]);
    });

    it("skips a leading geometry argument rather than reading it as a colour", () => {
      for (const geometry of [
        "from 45deg",
        "at 30% 70%",
        "from 0deg at center",
      ]) {
        const paint = paintFor(`conic-gradient(${geometry}, #000, #fff)`);

        expect(paint.type).toBe("GRADIENT_ANGULAR");
        expect(stopsOf(paint)).toHaveLength(2);
      }
    });
  });

  describe("repeating gradients", () => {
    it("tiles the ramp across the line instead of painting it once", () => {
      // A 20px period on a 120px-tall box repeats six times.
      const paint = paintFor(
        "repeating-linear-gradient(#000 0px, #000 10px, #fff 10px, #fff 20px)"
      );

      expect(paint.type).toBe("GRADIENT_LINEAR");
      expect(stopsOf(paint)).toHaveLength(24);
      expect(stopsOf(paint).map((stop) => stop.position.toFixed(4))).toContain(
        (1 / 6).toFixed(4)
      );
    });

    it("keeps hard stops hard by pairing the boundary offset", () => {
      const positions = stopsOf(
        paintFor(
          "repeating-linear-gradient(#000 0px, #000 10px, #fff 10px, #fff 20px)"
        )
      ).map((stop) => stop.position);

      // The 10px boundary carries two stops — end of black, start of white —
      // a hair apart rather than coincident, so Figma cannot reorder them.
      const boundary = positions.filter(
        (position) => Math.abs(position - 1 / 12) < 1e-3
      );
      expect(boundary).toHaveLength(2);
      expect(boundary[1]).toBeGreaterThan(Number(boundary[0]));
      expect(Number(boundary[1]) - Number(boundary[0])).toBeLessThan(1e-4);
    });

    it("emits strictly increasing offsets so the ramp cannot be reordered", () => {
      const positions = stopsOf(
        paintFor(
          "repeating-linear-gradient(#000 0px, #000 10px, #fff 10px, #fff 20px)"
        )
      ).map((stop) => stop.position);

      for (let i = 1; i < positions.length; i += 1) {
        expect(positions[i]).toBeGreaterThan(Number(positions[i - 1]));
      }
    });

    it("tiles a repeating radial ramp too", () => {
      const paint = paintFor(
        "repeating-radial-gradient(#000 0px, #000 10px, #fff 10px, #fff 20px)"
      );

      expect(paint.type).toBe("GRADIENT_RADIAL");
      expect(stopsOf(paint).length).toBeGreaterThan(4);
    });

    it("falls back to a single pass when the ramp spans the whole line", () => {
      const paint = paintFor("repeating-linear-gradient(#000, #fff)");

      expect(stopsOf(paint).map((stop) => stop.position)).toEqual([0, 1]);
    });

    it("does not explode into an unbounded stop list for a tiny period", () => {
      const paint = paintFor(
        "repeating-linear-gradient(#000 0px, #fff 0.05px)",
        { width: 200, height: 1200 }
      );

      expect(stopsOf(paint).length).toBeLessThanOrEqual(256);
    });
  });
});
