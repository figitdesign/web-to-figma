import { describe, expect, it } from "vitest";
import {
  applyCssColorMatrixFilters,
  hasColorMatrixFilter,
} from "./filter-color";

// #ef4444 in sRGB 0-1.
const RED = { r: 239 / 255, g: 68 / 255, b: 68 / 255, a: 1 };
const luma = (c: { r: number; g: number; b: number }) =>
  0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe("hasColorMatrixFilter", () => {
  it("detects bakeable color functions", () => {
    expect(hasColorMatrixFilter("grayscale(1)")).toBe(true);
    expect(hasColorMatrixFilter("brightness(0.5) contrast(2)")).toBe(true);
  });

  it("is false for none/empty and effect-only filters", () => {
    expect(hasColorMatrixFilter("none")).toBe(false);
    expect(hasColorMatrixFilter("")).toBe(false);
    expect(hasColorMatrixFilter("blur(4px)")).toBe(false);
    expect(hasColorMatrixFilter("drop-shadow(1px 1px 0 red)")).toBe(false);
  });
});

describe("applyCssColorMatrixFilters", () => {
  it("returns the color unchanged for none/empty", () => {
    expect(applyCssColorMatrixFilters(RED, "none")).toEqual(RED);
    expect(applyCssColorMatrixFilters(RED, "")).toEqual(RED);
  });

  it("grayscale(1) collapses channels to Rec.709 luma", () => {
    const out = applyCssColorMatrixFilters(RED, "grayscale(1)");
    expect(out.r).toBeCloseTo(luma(RED), 5);
    expect(out.g).toBeCloseTo(luma(RED), 5);
    expect(out.b).toBeCloseTo(luma(RED), 5);
    expect(out.a).toBe(1);
  });

  it("brightness(0.5) scales each channel", () => {
    const out = applyCssColorMatrixFilters(RED, "brightness(0.5)");
    expect(out.r).toBeCloseTo(RED.r * 0.5, 5);
    expect(out.g).toBeCloseTo(RED.g * 0.5, 5);
    expect(out.b).toBeCloseTo(RED.b * 0.5, 5);
  });

  it("contrast(1.8) pivots around 0.5 and clamps overflow", () => {
    const out = applyCssColorMatrixFilters(RED, "contrast(1.8)");
    // r: (0.937-0.5)*1.8+0.5 = 1.287 → clamped to 1
    expect(out.r).toBe(1);
    // g/b: (0.267-0.5)*1.8+0.5 = 0.081, in range
    expect(out.g).toBeCloseTo((RED.g - 0.5) * 1.8 + 0.5, 5);
  });

  it("invert(1) flips each channel", () => {
    const out = applyCssColorMatrixFilters(RED, "invert(1)");
    expect(out.r).toBeCloseTo(1 - RED.r, 5);
    expect(out.g).toBeCloseTo(1 - RED.g, 5);
  });

  it("parses percentage amounts like their numeric form", () => {
    expect(applyCssColorMatrixFilters(RED, "brightness(50%)").r).toBeCloseTo(
      RED.r * 0.5,
      5
    );
  });

  it("applies chained filters left-to-right, clamping between steps", () => {
    const out = applyCssColorMatrixFilters(RED, "brightness(2) grayscale(1)");
    const bright = {
      r: Math.min(1, RED.r * 2),
      g: Math.min(1, RED.g * 2),
      b: Math.min(1, RED.b * 2),
    };
    expect(out.r).toBeCloseTo(luma(bright), 5);
  });

  it("ignores blur()/drop-shadow() in the same value and keeps alpha", () => {
    const semi = { r: 1, g: 0, b: 0, a: 0.5 };
    const out = applyCssColorMatrixFilters(
      semi,
      "grayscale(1) blur(2px) drop-shadow(1px 1px 0 rgba(0,0,0,0.5))"
    );
    expect(out.r).toBeCloseTo(luma({ r: 1, g: 0, b: 0 }), 5);
    expect(out.a).toBe(0.5);
  });

  it("leaves the color unchanged for unsupported functions (hue-rotate)", () => {
    expect(applyCssColorMatrixFilters(RED, "hue-rotate(90deg)")).toEqual(RED);
  });
});
