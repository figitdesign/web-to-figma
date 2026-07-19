import { describe, expect, it } from "vitest";
import { recommendNoiseFloor } from "./calibrate";

describe("recommendNoiseFloor()", () => {
  it("floors on the observed cross-renderer AA when render noise is ~0", () => {
    // Figma render is deterministic, so render noise is 0; the floor is the
    // inherent AA margin, not zero.
    expect(recommendNoiseFloor([0, 0, 0])).toBeGreaterThan(0);
  });

  it("scales above the measured render noise when it's non-trivial", () => {
    const floor = recommendNoiseFloor([0.001, 0.002]);
    expect(floor).toBeGreaterThanOrEqual(0.002 * 5);
  });

  it("handles an empty sample", () => {
    expect(recommendNoiseFloor([])).toBeGreaterThan(0);
  });
});
