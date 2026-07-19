import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverScenes } from "./scenes";
import type { Scoreboard } from "./scoreboard";

// Guards the committed baseline against the corpus: adding or removing a scene
// must be accompanied by `check --update`, or this test fails.
const BASELINE_PATH = resolve(
  import.meta.dirname,
  "../baseline/scoreboard.json"
);

describe("committed baseline", () => {
  const baseline = JSON.parse(
    readFileSync(BASELINE_PATH, "utf-8")
  ) as Scoreboard;

  it("has schemaVersion 1 and tier-0 metrics for every scene", () => {
    expect(baseline.schemaVersion).toBe(1);
    for (const score of Object.values(baseline.scenes)) {
      expect(typeof score.tier0.findings).toBe("number");
      expect(typeof score.tier0.maxDeltaPx).toBe("number");
    }
  });

  it("covers exactly the committed corpus", () => {
    const corpus = discoverScenes()
      .map((s) => s.id)
      .sort();
    const baselineScenes = Object.keys(baseline.scenes).sort();
    expect(baselineScenes).toEqual(corpus);
  });
});
