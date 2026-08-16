import { describe, expect, it } from "vitest";
import { border3dSideColor, isBorder3dStyle } from "./border-3d";

/**
 * Every expectation here is a pixel measured off Chrome's own raster of a 12px
 * 3D border (oracle run `20260814-010004-probe`), not a value derived from this
 * implementation — that is what makes them a check on the shading model rather
 * than a restatement of it.
 */

const BLUE = "rgb(99, 102, 241)";
const BLUE_DARK = "rgb(64, 66, 157)";

function shade(
  style: "groove" | "ridge" | "inset" | "outset",
  side: "top" | "right" | "bottom" | "left",
  half: "outer" | "inner",
  color = BLUE
) {
  return border3dSideColor({ style, side, half, color });
}

describe("isBorder3dStyle()", () => {
  it("accepts the four 3D styles and rejects flat ones", () => {
    expect(["groove", "ridge", "inset", "outset"].every(isBorder3dStyle)).toBe(
      true
    );
    expect(
      ["solid", "dashed", "dotted", "double", "none"].some(isBorder3dStyle)
    ).toBe(false);
  });
});

describe("border3dSideColor() shading direction", () => {
  it("darkens the top and left of an inset border and lights the rest", () => {
    expect(shade("inset", "top", "outer")).toBe(BLUE_DARK);
    expect(shade("inset", "top", "inner")).toBe(BLUE_DARK);
    expect(shade("inset", "left", "outer")).toBe(BLUE_DARK);
    expect(shade("inset", "bottom", "outer")).toBe(BLUE);
    expect(shade("inset", "right", "inner")).toBe(BLUE);
  });

  it("mirrors inset for outset", () => {
    expect(shade("outset", "top", "outer")).toBe(BLUE);
    expect(shade("outset", "left", "inner")).toBe(BLUE);
    expect(shade("outset", "bottom", "outer")).toBe(BLUE_DARK);
    expect(shade("outset", "right", "outer")).toBe(BLUE_DARK);
  });

  it("bevels a ridge: lit outer half on top/left, shaded inner half", () => {
    expect(shade("ridge", "top", "outer")).toBe(BLUE);
    expect(shade("ridge", "top", "inner")).toBe(BLUE_DARK);
    expect(shade("ridge", "left", "outer")).toBe(BLUE);
    expect(shade("ridge", "left", "inner")).toBe(BLUE_DARK);
    expect(shade("ridge", "bottom", "outer")).toBe(BLUE_DARK);
    expect(shade("ridge", "bottom", "inner")).toBe(BLUE);
  });

  it("inverts the ridge bevel for a groove", () => {
    expect(shade("groove", "top", "outer")).toBe(BLUE_DARK);
    expect(shade("groove", "top", "inner")).toBe(BLUE);
    expect(shade("groove", "bottom", "outer")).toBe(BLUE);
    expect(shade("groove", "bottom", "inner")).toBe(BLUE_DARK);
  });
});

describe("border3dSideColor() shade math", () => {
  it("matches Chrome's darkened channels byte for byte", () => {
    const dark = (color: string) => shade("inset", "top", "outer", color);
    expect(dark("rgb(255, 255, 255)")).toBe("rgb(171, 171, 171)");
    expect(dark("rgb(128, 128, 128)")).toBe("rgb(44, 44, 44)");
    expect(dark("rgb(32, 32, 96)")).toBe("rgb(3, 3, 11)");
    expect(dark("rgb(0, 0, 0)")).toBe("rgb(0, 0, 0)");
  });

  it("lightens the lit sides when darkening cannot carry the bevel", () => {
    const lit = (color: string) => shade("inset", "bottom", "outer", color);
    // Black has nothing to darken, so Chrome lifts the lit sides to mid grey.
    expect(lit("rgb(0, 0, 0)")).toBe("rgb(84, 84, 84)");
    // Navy darkens to near-black — under the contrast floor, so it lightens.
    expect(lit("rgb(32, 32, 96)")).toBe("rgb(60, 60, 180)");
    // These clear the floor, so their lit sides stay as declared.
    expect(lit("rgb(128, 128, 128)")).toBe("rgb(128, 128, 128)");
    expect(lit(BLUE)).toBe(BLUE);
  });

  it("preserves alpha", () => {
    expect(shade("inset", "top", "outer", "rgba(99, 102, 241, 0.5)")).toBe(
      "rgba(64, 66, 157, 0.5)"
    );
  });

  it("passes an unparseable color straight through", () => {
    expect(shade("inset", "top", "outer", "")).toBe("");
  });
});
