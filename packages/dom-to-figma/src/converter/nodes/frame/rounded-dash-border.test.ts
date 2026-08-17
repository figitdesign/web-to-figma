import { describe, expect, it } from "vitest";
import { roundedDashedBorderPieces } from "./rounded-dash-border";

/**
 * The expectations here are pixels measured off Chrome's raster of the
 * `bord/bord-09-dashed-radius` scene — a 172×92 border box with a 6px dashed
 * border and a 20px radius — not values derived from this implementation.
 *
 * Chrome dashes that box with 26 dashes of 12px separated by 6.26px gaps, the
 * first one starting where the top-left arc ends (x = 20, the radius).
 */
const SCENE = { boxWidth: 172, boxHeight: 92, radius: 20, width: 6 };

describe("roundedDashedBorderPieces()", () => {
  it("starts the first dash where the top-left arc ends", () => {
    const pieces = roundedDashedBorderPieces(SCENE);
    const first = pieces?.[0];
    expect(first?.minX).toBeCloseTo(20, 5);
    expect(first?.minY).toBeCloseTo(0, 5);
    expect(first?.spanX).toBeCloseTo(12, 5);
    expect(first?.spanY).toBeCloseTo(6, 5);
  });

  it("fits Chrome's 26 dashes around the path", () => {
    const pieces = roundedDashedBorderPieces(SCENE) ?? [];
    // The pieces lying wholly between the two top corners, which Chrome
    // rasterizes as 8 whole dashes.
    const onTop = pieces
      .filter(
        (piece) =>
          piece.minY === 0 &&
          piece.minX >= SCENE.radius &&
          piece.minX + piece.spanX <= SCENE.boxWidth - SCENE.radius
      )
      .sort((a, b) => a.minX - b.minX);
    expect(onTop).toHaveLength(8);
    // 12px dashes, evenly spaced by the gap that closes the loop. The eighth
    // runs off the straight and into the corner, so only its stub lands here.
    for (const [index, piece] of onTop.entries()) {
      expect(piece.minX).toBeCloseTo(20 + index * 18.26, 1);
      expect(piece.spanY).toBeCloseTo(6, 5);
      expect(piece.spanX).toBeCloseTo(index === 7 ? 4.17 : 12, 1);
    }
  });

  it("carries dashes around the corners as arc sectors", () => {
    const pieces = roundedDashedBorderPieces(SCENE) ?? [];
    // A dash crossing into the top-right arc is cut in two, so the count
    // exceeds the 26 dashes themselves.
    expect(pieces.length).toBeGreaterThan(26);
    for (const piece of pieces) {
      expect(piece.spanX).toBeGreaterThan(0);
      expect(piece.spanY).toBeGreaterThan(0);
      expect(piece.minX).toBeGreaterThanOrEqual(-0.001);
      expect(piece.minY).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it("declines boxes with no radius, or one the border swallows", () => {
    expect(roundedDashedBorderPieces({ ...SCENE, radius: 0 })).toBeNull();
    expect(roundedDashedBorderPieces({ ...SCENE, radius: 3 })).toBeNull();
    expect(roundedDashedBorderPieces({ ...SCENE, width: 0 })).toBeNull();
  });

  it("declines a hairline dash that would flood the scene with nodes", () => {
    expect(
      roundedDashedBorderPieces({
        boxWidth: 1200,
        boxHeight: 800,
        radius: 20,
        width: 1,
      })
    ).toBeNull();
  });
});
