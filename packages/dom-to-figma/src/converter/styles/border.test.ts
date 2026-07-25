import { describe, expect, it } from "vitest";
import { parseBorderFromComputedStyle } from "./border";

type StyleOverrides = Partial<Record<string, string>>;

/** A computed style carrying just the properties the border parser reads. */
function computedStyle(overrides: StyleOverrides): CSSStyleDeclaration {
  const base: Record<string, string> = {
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    borderTopStyle: "none",
    borderRightStyle: "none",
    borderBottomStyle: "none",
    borderLeftStyle: "none",
    borderColor: "rgb(29, 78, 216)",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    borderBottomRightRadius: "0px",
    ...overrides,
  };
  return {
    ...base,
    getPropertyValue: (prop: string) => base[prop] ?? "",
  } as unknown as CSSStyleDeclaration;
}

/** A uniform border of `width` px in `style` on all four sides. */
function uniformBorder(style: string, width = 6): CSSStyleDeclaration {
  return computedStyle({
    borderTopWidth: `${width}px`,
    borderRightWidth: `${width}px`,
    borderBottomWidth: `${width}px`,
    borderLeftWidth: `${width}px`,
    borderTopStyle: style,
    borderRightStyle: style,
    borderBottomStyle: style,
    borderLeftStyle: style,
  });
}

describe("parseBorderFromComputedStyle() dash pattern", () => {
  it("dots a uniform dotted border at the border width", () => {
    const props = parseBorderFromComputedStyle(uniformBorder("dotted"));

    // Chrome paints dots of the border width with an equal gap.
    expect(props.dashPattern).toEqual([6, 6]);
    expect(props.strokeWeight).toBe(6);
  });

  it("scales the dots with the border width", () => {
    const props = parseBorderFromComputedStyle(uniformBorder("dotted", 3));

    expect(props.dashPattern).toEqual([3, 3]);
  });

  // Figma runs one pattern around the whole path while Chrome fits dashes to
  // each side, so a dashed pattern drifts out of phase and scores worse than
  // just drawing the border solid.
  it("leaves a dashed border solid", () => {
    const props = parseBorderFromComputedStyle(uniformBorder("dashed"));

    expect(props.dashPattern).toBeUndefined();
  });

  it("leaves solid and double borders alone", () => {
    for (const style of ["solid", "double"]) {
      const props = parseBorderFromComputedStyle(uniformBorder(style, 9));

      expect(props.dashPattern).toBeUndefined();
    }
  });

  it("does not dot when only some sides are dotted", () => {
    const props = parseBorderFromComputedStyle(
      computedStyle({
        borderTopWidth: "6px",
        borderRightWidth: "6px",
        borderBottomWidth: "6px",
        borderLeftWidth: "6px",
        borderTopStyle: "dotted",
        borderRightStyle: "solid",
        borderBottomStyle: "dotted",
        borderLeftStyle: "solid",
      })
    );

    expect(props.dashPattern).toBeUndefined();
  });

  it("does not dot a zero-width border", () => {
    const props = parseBorderFromComputedStyle(uniformBorder("dotted", 0));

    expect(props.dashPattern).toBeUndefined();
  });
});
