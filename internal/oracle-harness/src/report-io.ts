import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding } from "./findings";
import type { Report, SceneResult } from "./report";
import { buildReport, buildSceneResult } from "./report";
import { renderReportHtml } from "./report-html";

type RunManifest = {
  layout: "auto" | "absolute";
  scenes: Array<{ sceneId: string; stem: string }>;
};

/** Read a run dir's manifest + per-scene tier-0 findings and assemble a report. */
export function assembleReport(
  runDir: string,
  meta: { runId: string; commit: string; createdAt: string }
): Report {
  const manifest = JSON.parse(
    readFileSync(resolve(runDir, "run.json"), "utf-8")
  ) as RunManifest;

  const scenes: Array<SceneResult> = [];
  const rawFindings: Array<Finding> = [];
  for (const { sceneId, stem } of manifest.scenes) {
    const findings = JSON.parse(
      readFileSync(resolve(runDir, "diff", `${stem}.tier0.json`), "utf-8")
    ) as Array<Finding>;
    scenes.push(buildSceneResult(sceneId, manifest.layout, findings));
    rawFindings.push(...findings);
  }

  return buildReport({ ...meta, tiersRun: [0], scenes, rawFindings });
}

/** Write `report.json` and `report.html` into the run dir. */
export function writeReport(runDir: string, report: Report): void {
  writeFileSync(
    resolve(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  writeFileSync(resolve(runDir, "report.html"), renderReportHtml(report));
}
