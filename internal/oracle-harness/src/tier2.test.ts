import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { diffTier2 } from "./tier2";

/** A solid RGBA PNG buffer. */
function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number]
) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

describe("diffTier2()", () => {
  it("downsamples a 2× figma png and reports zero for a match", () => {
    const result = diffTier2({
      sceneId: "s",
      domPng: solidPng(20, 10, WHITE),
      figmaPng: solidPng(40, 20, WHITE), // 2× of 20×10
      elements: [],
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.diffRatio).toBe(0);
      expect(result.findings).toEqual([]);
    }
  });

  it("aligns the overlap and flags a size delta when figma hugged narrower", () => {
    const result = diffTier2({
      sceneId: "s",
      domPng: solidPng(20, 10, WHITE),
      figmaPng: solidPng(32, 20, WHITE), // 2× of 16×10 — narrower than the dom
      elements: [],
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      const size = result.findings.find((f) => f.class === "pixel.size");
      expect(size).toBeDefined();
      expect(size?.expected).toBe("20×10");
      expect(size?.actual).toBe("16×10");
    }
  });

  it("reports a high diff ratio when the renders differ", () => {
    const result = diffTier2({
      sceneId: "s",
      domPng: solidPng(20, 10, WHITE),
      figmaPng: solidPng(40, 20, BLACK),
      elements: [],
    });
    if (!("error" in result)) {
      expect(result.diffRatio).toBeGreaterThan(0.9);
    }
  });
});
