import { describe, expect, it } from "vitest";
import { parseFontFeatures } from "./features";

function style(
  overrides: Partial<Record<string, string>>
): CSSStyleDeclaration {
  return {
    fontVariantNumeric: "normal",
    fontFeatureSettings: "normal",
    ...overrides,
  } as unknown as CSSStyleDeclaration;
}

describe("parseFontFeatures()", () => {
  it("asks for nothing when the style is default", () => {
    expect(parseFontFeatures(style({}))).toEqual([]);
  });

  it("maps font-variant-numeric keywords to feature tags", () => {
    expect(
      parseFontFeatures(style({ fontVariantNumeric: "tabular-nums" }))
    ).toEqual(["tnum"]);
    expect(
      parseFontFeatures(style({ fontVariantNumeric: "oldstyle-nums" }))
    ).toEqual(["onum"]);
  });

  it("reads several keywords from one declaration", () => {
    expect(
      parseFontFeatures(
        style({ fontVariantNumeric: "tabular-nums slashed-zero" })
      )
    ).toEqual(["tnum", "zero"]);
  });

  it("reads font-feature-settings with and without a value", () => {
    expect(
      parseFontFeatures(style({ fontFeatureSettings: '"tnum" 1' }))
    ).toEqual(["tnum"]);
    expect(parseFontFeatures(style({ fontFeatureSettings: "'tnum'" }))).toEqual(
      ["tnum"]
    );
    expect(
      parseFontFeatures(style({ fontFeatureSettings: '"tnum" on, "zero" on' }))
    ).toEqual(["tnum", "zero"]);
  });

  it("lets font-feature-settings switch a feature back off", () => {
    expect(
      parseFontFeatures(
        style({
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 0',
        })
      )
    ).toEqual([]);
  });

  it("ignores keywords and tags it does not recognise", () => {
    expect(
      parseFontFeatures(
        style({ fontVariantNumeric: "wobbly", fontFeatureSettings: "nonsense" })
      )
    ).toEqual([]);
  });
});
