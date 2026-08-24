import { describe, expect, it } from "vitest";
import { cssMixBlendModeToFigmaBlendMode } from "./blend";

describe("cssMixBlendModeToFigmaBlendMode", () => {
  it("returns null for normal, so the node keeps PASS_THROUGH", () => {
    expect(cssMixBlendModeToFigmaBlendMode("normal")).toBeNull();
  });

  it("returns null for missing or empty values", () => {
    expect(cssMixBlendModeToFigmaBlendMode(undefined)).toBeNull();
    expect(cssMixBlendModeToFigmaBlendMode("")).toBeNull();
  });

  it("maps the separable blend modes", () => {
    expect(cssMixBlendModeToFigmaBlendMode("multiply")).toBe("MULTIPLY");
    expect(cssMixBlendModeToFigmaBlendMode("screen")).toBe("SCREEN");
    expect(cssMixBlendModeToFigmaBlendMode("overlay")).toBe("OVERLAY");
    expect(cssMixBlendModeToFigmaBlendMode("difference")).toBe("DIFFERENCE");
  });

  it("maps hyphenated keywords to their SCREAMING_SNAKE Figma names", () => {
    expect(cssMixBlendModeToFigmaBlendMode("color-dodge")).toBe("COLOR_DODGE");
    expect(cssMixBlendModeToFigmaBlendMode("soft-light")).toBe("SOFT_LIGHT");
  });

  it("maps the non-separable blend modes", () => {
    expect(cssMixBlendModeToFigmaBlendMode("hue")).toBe("HUE");
    expect(cssMixBlendModeToFigmaBlendMode("luminosity")).toBe("LUMINOSITY");
  });

  it("maps plus-lighter/plus-darker to Figma's linear dodge/burn", () => {
    expect(cssMixBlendModeToFigmaBlendMode("plus-lighter")).toBe(
      "LINEAR_DODGE"
    );
    expect(cssMixBlendModeToFigmaBlendMode("plus-darker")).toBe("LINEAR_BURN");
  });

  it("returns null for keywords Figma cannot express", () => {
    expect(cssMixBlendModeToFigmaBlendMode("plus-lighten")).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(cssMixBlendModeToFigmaBlendMode("  Multiply ")).toBe("MULTIPLY");
  });
});
