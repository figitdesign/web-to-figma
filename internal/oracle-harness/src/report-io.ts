import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding } from "./findings";
import type { Report, SceneResult } from "./report";
import { buildReport, buildSceneResult } from "./report";
import { renderReportHtml } from "./report-html";

type RunManifest = {
  layout: "auto" | "absolute";
  scenes: Array<{ sceneId: string; stem: string }>;
};

function readFindings(path: string): Array<Finding> {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as Array<Finding>)
    : [];
}

function readTier2(
  path: string
): { diffRatio: number; findings: Array<Finding> } | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as {
        diffRatio: number;
        findings: Array<Finding>;
      })
    : undefined;
}

/** Read a run dir's manifest + per-scene tier-0/1/2 artifacts and assemble a
 * report. Tiers 1 and 2 are included per-scene only when their artifacts exist
 * (i.e. after a `figma run`). */
export function assembleReport(
  runDir: string,
  meta: { runId: string; commit: string; createdAt: string }
): Report {
  const manifest = JSON.parse(
    readFileSync(resolve(runDir, "run.json"), "utf-8")
  ) as RunManifest;
  const diff = (stem: string, tier: string) =>
    resolve(runDir, "diff", `${stem}.${tier}.json`);

  const scenes: Array<SceneResult> = [];
  const rawFindings: Array<Finding> = [];
  const tiersRun = new Set<0 | 1 | 2>([0]);

  for (const { sceneId, stem } of manifest.scenes) {
    const tier0 = readFindings(diff(stem, "tier0"));
    const tier1Path = diff(stem, "tier1");
    const tier1 = existsSync(tier1Path) ? readFindings(tier1Path) : undefined;
    const tier2 = readTier2(diff(stem, "tier2"));

    scenes.push(
      buildSceneResult({
        sceneId,
        layout: manifest.layout,
        tier0,
        tier1,
        tier2,
      })
    );
    rawFindings.push(...tier0);
    if (tier1) {
      rawFindings.push(...tier1);
      tiersRun.add(1);
    }
    if (tier2) {
      rawFindings.push(...tier2.findings);
      tiersRun.add(2);
    }
  }

  return buildReport({
    ...meta,
    tiersRun: [...tiersRun].sort(),
    scenes,
    rawFindings,
  });
}

/** Write `report.json` and `report.html` into the run dir. */
export function writeReport(runDir: string, report: Report): void {
  writeFileSync(
    resolve(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  writeFileSync(resolve(runDir, "report.html"), renderReportHtml(report));
}
