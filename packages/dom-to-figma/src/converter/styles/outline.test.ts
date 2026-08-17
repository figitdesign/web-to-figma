import { describe, expect, it } from "vitest";
import { parseOutlineFromComputedStyle } from "./outline";

type StyleOverrides = Partial<Record<string, string>>;

function computedStyle(overrides: StyleOverrides): CSSStyleDeclaration {
  const base: Record<string, string> = {
    outlineStyle: "none",
    outlineWidth: "0px",
    outlineColor: "rgb(29, 78, 216)",
    outlineOffset: "0px",
    ...overrides,
  };
  return {
    ...base,
    getPropertyValue: (prop: string) => base[prop] ?? "",
  } as unknown as CSSStyleDeclaration;
}

describe("parseOutlineFromComputedStyle()", () => {
  it("reads a solid outline and its offset", () => {
    const outline = parseOutlineFromComputedStyle(
      computedStyle({
        outlineStyle: "solid",
        outlineWidth: "4px",
        outlineOffset: "6px",
      })
    );
    expect(outline?.width).toBe(4);
    expect(outline?.offset).toBe(6);
    expect(outline?.strokePaints).toHaveLength(1);
    expect(outline?.dashPattern).toBeUndefined();
  });

  it("keeps a negative offset, which pulls the ring over the box", () => {
    const outline = parseOutlineFromComputedStyle(
      computedStyle({
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineOffset: "-3px",
      })
    );
    expect(outline?.offset).toBe(-3);
  });

  it("dots a dotted outline with round caps", () => {
    const outline = parseOutlineFromComputedStyle(
      computedStyle({ outlineStyle: "dotted", outlineWidth: "3px" })
    );
    expect(outline?.dashPattern).toEqual([3, 3]);
    expect(outline?.strokeCap).toBe("ROUND");
  });

  it("returns nothing for an absent, zero-width or invisible outline", () => {
    expect(
      parseOutlineFromComputedStyle(computedStyle({ outlineWidth: "4px" }))
    ).toBeUndefined();
    expect(
      parseOutlineFromComputedStyle(computedStyle({ outlineStyle: "solid" }))
    ).toBeUndefined();
    expect(
      parseOutlineFromComputedStyle(
        computedStyle({
          outlineStyle: "solid",
          outlineWidth: "4px",
          outlineColor: "rgba(0, 0, 0, 0)",
        })
      )
    ).toBeUndefined();
  });

  it("leaves styles that need more than one ring unconverted", () => {
    for (const style of ["double", "groove", "ridge", "inset", "outset"]) {
      expect(
        parseOutlineFromComputedStyle(
          computedStyle({ outlineStyle: style, outlineWidth: "4px" })
        )
      ).toBeUndefined();
    }
  });
});
