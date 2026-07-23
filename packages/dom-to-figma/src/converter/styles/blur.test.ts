import { describe, expect, it } from "vitest";
import { cssFilterToFigmaEffects } from "./blur";

describe("cssFilterToFigmaEffects", () => {
  it("returns no effects for none/empty", () => {
    expect(cssFilterToFigmaEffects("none")).toEqual([]);
    expect(cssFilterToFigmaEffects("")).toEqual([]);
  });

  it("maps blur() to a FOREGROUND_BLUR", () => {
    const [effect, ...rest] = cssFilterToFigmaEffects("blur(6px)");

    expect(rest).toHaveLength(0);
    expect(effect?.type).toBe("FOREGROUND_BLUR");
    expect(effect?.radius).toBe(6);
  });

  it("maps drop-shadow() (computed color-first form) to a DROP_SHADOW", () => {
    // Browsers normalize the argument to `<color> <x> <y> <blur>`.
    const [effect, ...rest] = cssFilterToFigmaEffects(
      "drop-shadow(rgba(0, 0, 0, 0.5) 8px 8px 5px)"
    );

    expect(rest).toHaveLength(0);
    expect(effect?.type).toBe("DROP_SHADOW");
    expect(effect?.offset).toEqual({ x: 8, y: 8 });
    expect(effect?.radius).toBe(5);
    // drop-shadow has no spread radius.
    expect(effect?.spread).toBe(0);
    expect(effect?.color?.a).toBeCloseTo(0.5, 5);
  });

  it("maps the author shorthand drop-shadow() with a hex color", () => {
    const [effect] = cssFilterToFigmaEffects(
      "drop-shadow(8px 8px 5px #000000)"
    );

    expect(effect?.type).toBe("DROP_SHADOW");
    expect(effect?.offset).toEqual({ x: 8, y: 8 });
    expect(effect?.radius).toBe(5);
  });

  it("defaults the blur to zero when drop-shadow omits it", () => {
    const [effect] = cssFilterToFigmaEffects("drop-shadow(4px 4px #ff0000)");

    expect(effect?.offset).toEqual({ x: 4, y: 4 });
    expect(effect?.radius).toBe(0);
  });

  it("extracts drop-shadow() paren-aware so nested color fns don't truncate it", () => {
    // A naive `drop-shadow\(([^)]+)\)` would stop at hsl(...)'s first ')'.
    const [effect, ...rest] = cssFilterToFigmaEffects(
      "drop-shadow(hsl(0, 100%, 50%) 3px 3px 2px)"
    );

    expect(rest).toHaveLength(0);
    expect(effect?.type).toBe("DROP_SHADOW");
    expect(effect?.offset).toEqual({ x: 3, y: 3 });
    expect(effect?.radius).toBe(2);
  });

  it("maps each drop-shadow() to its own effect, in order", () => {
    const effects = cssFilterToFigmaEffects(
      "drop-shadow(1px 1px 0 #ff0000) drop-shadow(-2px -2px 3px #0000ff)"
    );

    expect(effects).toHaveLength(2);
    expect(effects[0]?.offset).toEqual({ x: 1, y: 1 });
    expect(effects[0]?.radius).toBe(0);
    expect(effects[1]?.offset).toEqual({ x: -2, y: -2 });
    expect(effects[1]?.radius).toBe(3);
    for (const effect of effects) {
      expect(effect.type).toBe("DROP_SHADOW");
    }
  });

  it("handles blur() and drop-shadow() together", () => {
    const effects = cssFilterToFigmaEffects(
      "blur(2px) drop-shadow(4px 4px 4px #000000)"
    );

    const blur = effects.find((e) => e.type === "FOREGROUND_BLUR");
    const shadow = effects.find((e) => e.type === "DROP_SHADOW");
    expect(blur?.radius).toBe(2);
    expect(shadow?.offset).toEqual({ x: 4, y: 4 });
    expect(shadow?.radius).toBe(4);
  });

  it("ignores color-matrix filters with no Figma equivalent", () => {
    expect(cssFilterToFigmaEffects("grayscale(1)")).toEqual([]);
    expect(cssFilterToFigmaEffects("brightness(0.5) contrast(2)")).toEqual([]);
  });
});
