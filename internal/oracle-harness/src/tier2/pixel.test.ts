import { describe, expect, it } from "vitest";
import type { PngData } from "./pixel";
import { diffImages, downsample } from "./pixel";

function solid(
  width: number,
  height: number,
  [r, g, b, a]: [number, number, number, number]
): PngData {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

describe("downsample()", () => {
  it("halves dimensions and averages blocks", () => {
    const out = downsample(solid(4, 4, [100, 120, 140, 255]), 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([out.data[0], out.data[1], out.data[2], out.data[3]]).toEqual([
      100, 120, 140, 255,
    ]);
  });

  it("averages a checkerboard block to its mean", () => {
    // Two white + two black pixels in a 2×2 block → mid grey.
    const src: PngData = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      ]),
    };
    const out = downsample(src, 2);
    expect(out.data[0]).toBe(128); // round(510/4)
  });
});

describe("diffImages()", () => {
  it("reports zero for identical images", () => {
    const diff = diffImages(
      solid(8, 8, [255, 0, 0, 255]),
      solid(8, 8, [255, 0, 0, 255])
    );
    expect(diff.diffRatio).toBe(0);
    expect([...diff.mask].every((v) => v === 0)).toBe(true);
  });

  it("marks every pixel when images fully differ", () => {
    const diff = diffImages(
      solid(8, 8, [255, 255, 255, 255]),
      solid(8, 8, [0, 0, 0, 255])
    );
    expect(diff.diffRatio).toBeGreaterThan(0.9);
    expect([...diff.mask].every((v) => v === 1)).toBe(true);
    expect(diff.diffPng.length).toBeGreaterThan(0);
  });
});
