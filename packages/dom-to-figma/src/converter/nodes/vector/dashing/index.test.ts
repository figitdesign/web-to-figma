import { describe, expect, it } from "vitest";
import { parseAndNormalizePath } from "../path-parser";
import { convertPathToVectorNetwork } from "../path-to-network";
import type { VectorNetwork } from "../vector-networks/types";
import { bakeDashesIntoNetwork } from "./index";

function networkFor(path: string): VectorNetwork {
  return convertPathToVectorNetwork(parseAndNormalizePath(path), {
    normalize: false,
  }).vectorNetwork;
}

/** Each segment as `[startX, startY, endX, endY]`, rounded to 3 decimals. */
function segmentPoints(network: VectorNetwork): Array<Array<number>> {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return network.segments.map((segment) => {
    const start = network.vertices[segment.start.vertex];
    const end = network.vertices[segment.end.vertex];
    return [
      round(start?.x ?? 0),
      round(start?.y ?? 0),
      round(end?.x ?? 0),
      round(end?.y ?? 0),
    ];
  });
}

function totalLength(network: VectorNetwork): number {
  return segmentPoints(network).reduce(
    (sum, [x0, y0, x1, y1]) =>
      sum + Math.hypot((x1 ?? 0) - (x0 ?? 0), (y1 ?? 0) - (y0 ?? 0)),
    0
  );
}

describe("bakeDashesIntoNetwork", () => {
  it("cuts a straight line at the exact dash boundaries", () => {
    const baked = bakeDashesIntoNetwork(networkFor("M0 0 L20 0"), [4, 4]);

    expect(segmentPoints(baked as VectorNetwork)).toEqual([
      [0, 0, 4, 0],
      [8, 0, 12, 0],
      [16, 0, 20, 0],
    ]);
  });

  it("carries the dash phase across a corner", () => {
    // The 10px top edge ends mid-dash, so the dash continues down the side.
    const baked = bakeDashesIntoNetwork(
      networkFor("M0 0 L10 0 L10 10"),
      [6, 6]
    );

    expect(segmentPoints(baked as VectorNetwork)).toEqual([
      [0, 0, 6, 0],
      [10, 2, 10, 8],
    ]);
  });

  it("starts a fresh phase on each subpath", () => {
    const baked = bakeDashesIntoNetwork(
      networkFor("M0 0 L6 0 M0 10 L6 10"),
      [4, 4]
    );

    expect(segmentPoints(baked as VectorNetwork)).toEqual([
      [0, 0, 4, 0],
      [0, 10, 4, 10],
    ]);
  });

  it("runs the pattern around a closed rect from its start point", () => {
    const baked = bakeDashesIntoNetwork(
      networkFor("M0 0 H70 V80 H0 Z"),
      [12, 8]
    );

    // 70 is 3.5 periods, so the fourth dash straddles the top-right corner —
    // exactly what Figma's own re-fitted dashPattern refuses to do.
    expect(segmentPoints(baked as VectorNetwork).slice(0, 5)).toEqual([
      [0, 0, 12, 0],
      [20, 0, 32, 0],
      [40, 0, 52, 0],
      [60, 0, 70, 0],
      [70, 0, 70, 2],
    ]);
  });

  it("shifts the pattern by a dash offset", () => {
    const baked = bakeDashesIntoNetwork(networkFor("M0 0 L20 0"), [4, 4], 2);

    expect(segmentPoints(baked as VectorNetwork)).toEqual([
      [0, 0, 2, 0],
      [6, 0, 10, 0],
      [14, 0, 18, 0],
    ]);
  });

  it("doubles an odd-length pattern the way SVG does", () => {
    const baked = bakeDashesIntoNetwork(networkFor("M0 0 L20 0"), [5]);

    expect(segmentPoints(baked as VectorNetwork)).toEqual([
      [0, 0, 5, 0],
      [10, 0, 15, 0],
    ]);
  });

  it("keeps a curve's dashes on the curve", () => {
    const network = networkFor("M0 0 C0 20 40 20 40 0");
    const baked = bakeDashesIntoNetwork(network, [8, 8]);

    // Dashes on a cubic stay cubics — each keeps a tangent of its own — and
    // together they cover less of the path than the solid stroke did.
    expect(baked?.segments.length).toBeGreaterThan(1);
    expect(
      baked?.segments.every(
        (segment) => segment.start.dx !== 0 || segment.start.dy !== 0
      )
    ).toBe(true);
    expect(totalLength(baked as VectorNetwork)).toBeLessThan(
      totalLength(network)
    );
  });

  it("drops the fill regions it can no longer describe", () => {
    const baked = bakeDashesIntoNetwork(
      networkFor("M0 0 H20 V20 H0 Z"),
      [4, 4]
    );

    expect(baked?.regions).toEqual([]);
  });

  it("declines a pattern that paints nothing", () => {
    expect(bakeDashesIntoNetwork(networkFor("M0 0 L20 0"), [0, 0])).toBeNull();
    expect(bakeDashesIntoNetwork(networkFor("M0 0 L20 0"), [])).toBeNull();
  });

  it("declines a pattern too fine for the segment budget", () => {
    expect(
      bakeDashesIntoNetwork(networkFor("M0 0 L20000 0"), [1, 1])
    ).toBeNull();
  });
});
