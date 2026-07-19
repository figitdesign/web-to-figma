import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assembleReport } from "./report-io";

const META = { runId: "r", commit: "c", createdAt: "t" };

function makeRun(withUpperTiers: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "report-io-"));
  const diff = resolve(dir, "diff");
  mkdirSync(diff, { recursive: true });
  writeFileSync(
    resolve(dir, "run.json"),
    JSON.stringify({
      layout: "auto",
      scenes: [{ sceneId: "a/b", stem: "a__b" }],
    })
  );
  writeFileSync(resolve(diff, "a__b.tier0.json"), "[]");
  if (withUpperTiers) {
    writeFileSync(
      resolve(diff, "a__b.tier1.json"),
      JSON.stringify([
        {
          sceneId: "a/b",
          tier: 1,
          class: "kiwi.size.x",
          severity: 0.5,
          deltaPx: 4,
        },
      ])
    );
    writeFileSync(
      resolve(diff, "a__b.tier2.json"),
      JSON.stringify({
        diffRatio: 0.03,
        findings: [
          { sceneId: "a/b", tier: 2, class: "pixel.region", severity: 0.2 },
        ],
      })
    );
  }
  return dir;
}

describe("assembleReport()", () => {
  const withTiers = makeRun(true);
  const tier0Only = makeRun(false);

  afterAll(() => {
    rmSync(withTiers, { recursive: true, force: true });
    rmSync(tier0Only, { recursive: true, force: true });
  });

  it("reads all three tiers and merges their findings", () => {
    const report = assembleReport(withTiers, META);
    expect(report.tiersRun).toEqual([0, 1, 2]);
    const scene = report.scenes[0];
    expect(scene?.tier1?.findings).toBe(1);
    expect(scene?.tier1?.maxDeltaPx).toBe(4);
    expect(scene?.tier2?.diffRatio).toBe(0.03);
    expect(scene?.tier2?.clusters).toBe(1);
    expect(report.findings).toHaveLength(2);
  });

  it("stays tier-0 only when the upper-tier artifacts are absent", () => {
    const report = assembleReport(tier0Only, META);
    expect(report.tiersRun).toEqual([0]);
    expect(report.scenes[0]?.tier1).toBeUndefined();
    expect(report.scenes[0]?.tier2).toBeUndefined();
  });
});
