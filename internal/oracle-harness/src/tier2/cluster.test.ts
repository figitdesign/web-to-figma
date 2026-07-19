import { describe, expect, it } from "vitest";
import { clusterMask } from "./cluster";

const W = 64;
const H = 64;

function maskWith(blocks: Array<[number, number, number, number]>): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (const [x, y, w, h] of blocks) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        mask[yy * W + xx] = 1;
      }
    }
  }
  return mask;
}

describe("clusterMask()", () => {
  it("returns nothing for an empty mask", () => {
    expect(clusterMask(new Uint8Array(W * H), W, H)).toEqual([]);
  });

  it("finds one cluster covering a block", () => {
    const clusters = clusterMask(maskWith([[10, 10, 12, 12]]), W, H);
    expect(clusters).toHaveLength(1);
    const c = clusters[0];
    // grid-aligned bbox (8px cells) contains the block.
    expect(c && c.x <= 10 && c.y <= 10).toBe(true);
    expect(c && c.x + c.width >= 22 && c.y + c.height >= 22).toBe(true);
  });

  it("separates two distant blocks into two clusters", () => {
    const clusters = clusterMask(
      maskWith([
        [2, 2, 8, 8],
        [48, 48, 8, 8],
      ]),
      W,
      H
    );
    expect(clusters).toHaveLength(2);
  });

  it("merges touching blocks into one cluster", () => {
    const clusters = clusterMask(
      maskWith([
        [10, 10, 8, 8],
        [18, 10, 8, 8],
      ]),
      W,
      H
    );
    expect(clusters).toHaveLength(1);
  });
});
