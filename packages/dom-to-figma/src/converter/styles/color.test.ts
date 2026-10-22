import { describe, expect, it } from "vitest";
import { cssColorToFigmaColor } from "./color";

describe("cssColorToFigmaColor", () => {
  it("returns null for a value that is not a colour instead of throwing", () => {
    expect(cssColorToFigmaColor('url("#gradient")')).toBeNull();
    expect(cssColorToFigmaColor("context-fill")).toBeNull();
  });

  it("returns null for css transparent values", () => {
    expect(cssColorToFigmaColor("transparent")).toBeNull();
    expect(cssColorToFigmaColor("none")).toBeNull();
    expect(cssColorToFigmaColor("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("parses opaque hex into srgb 0-1 channels", () => {
    const result = cssColorToFigmaColor("#ff0000");

    expect(result).not.toBeNull();
    expect(result?.color.r).toBeCloseTo(1, 5);
    expect(result?.color.g).toBeCloseTo(0, 5);
    expect(result?.color.b).toBeCloseTo(0, 5);
    expect(result?.opacity).toBe(1);
  });

  it("parses rgba alpha into the opacity field, color stays opaque", () => {
    const result = cssColorToFigmaColor("rgba(255, 0, 0, 0.5)");

    expect(result?.opacity).toBeCloseTo(0.5, 5);
    expect(result?.color.a).toBe(1);
  });
});
