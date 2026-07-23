import { describe, expect, it } from "vitest";
import { cssTextShadowToFigmaEffects } from "./shadow";

describe("cssTextShadowToFigmaEffects", () => {
  it("returns no effects for none/empty", () => {
    expect(cssTextShadowToFigmaEffects("none")).toEqual([]);
    expect(cssTextShadowToFigmaEffects("")).toEqual([]);
  });

  it("parses the computed color-first form into a DROP_SHADOW", () => {
    // Browsers normalize `text-shadow` to `<color> <x> <y> <blur>`.
    const [effect, ...rest] = cssTextShadowToFigmaEffects(
      "rgb(245, 158, 11) 5px 5px 0px"
    );

    expect(rest).toHaveLength(0);
    expect(effect?.type).toBe("DROP_SHADOW");
    expect(effect?.offset).toEqual({ x: 5, y: 5 });
    expect(effect?.radius).toBe(0);
    // text-shadow has no spread radius.
    expect(effect?.spread).toBe(0);
    // #f59e0b in sRGB 0-1, fully opaque.
    expect(effect?.color?.r).toBeCloseTo(0.961, 2);
    expect(effect?.color?.g).toBeCloseTo(0.62, 2);
    expect(effect?.color?.b).toBeCloseTo(0.043, 2);
    expect(effect?.color?.a).toBe(1);
  });

  it("parses the author shorthand form with a hex color", () => {
    const [effect] = cssTextShadowToFigmaEffects("5px 5px 0 #f59e0b");

    expect(effect?.type).toBe("DROP_SHADOW");
    expect(effect?.offset).toEqual({ x: 5, y: 5 });
    expect(effect?.radius).toBe(0);
  });

  it("carries the blur radius and rgba alpha through", () => {
    const [effect] = cssTextShadowToFigmaEffects(
      "rgba(0, 0, 0, 0.5) 2px 2px 4px"
    );

    expect(effect?.radius).toBe(4);
    expect(effect?.offset).toEqual({ x: 2, y: 2 });
    expect(effect?.color?.a).toBeCloseTo(0.5, 5);
  });

  it("defaults the blur to zero when the shorthand omits it", () => {
    const [effect] = cssTextShadowToFigmaEffects("2px 2px red");

    expect(effect?.offset).toEqual({ x: 2, y: 2 });
    expect(effect?.radius).toBe(0);
  });

  it("supports negative offsets", () => {
    const [effect] = cssTextShadowToFigmaEffects("#000 -3px -3px 2px");

    expect(effect?.offset).toEqual({ x: -3, y: -3 });
    expect(effect?.radius).toBe(2);
  });

  it("maps each comma-separated shadow to its own effect, in order", () => {
    const effects = cssTextShadowToFigmaEffects(
      "rgb(255, 0, 0) 1px 1px 0px, rgb(0, 0, 255) -2px -2px 3px"
    );

    expect(effects).toHaveLength(2);
    expect(effects[0]?.offset).toEqual({ x: 1, y: 1 });
    expect(effects[0]?.radius).toBe(0);
    expect(effects[1]?.offset).toEqual({ x: -2, y: -2 });
    expect(effects[1]?.radius).toBe(3);
    for (const effect of effects) {
      expect(effect.type).toBe("DROP_SHADOW");
      expect(effect.spread).toBe(0);
    }
  });
});
