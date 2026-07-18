import { describe, expect, it } from "vitest";
import type { SceneResult } from "./report";
import { buildReport, buildSceneResult } from "./report";
import { renderReportHtml, renderStepSummary } from "./report-html";

function reportWith(scenes: Array<SceneResult>, rawFindings = []) {
  return buildReport({
    runId: "r1",
    commit: "abc123",
    createdAt: "2026-07-19T00:00:00Z",
    tiersRun: [0],
    scenes,
    rawFindings,
  });
}

describe("renderReportHtml()", () => {
  it("emits one row per scene and no unresolved placeholders", () => {
    const report = reportWith([
      buildSceneResult("00-smoke/two-boxes", "auto", []),
      buildSceneResult("01-flex/row-basic", "auto", []),
    ]);
    const html = renderReportHtml(report);

    const bodyRows = html.split("<tbody>").pop() ?? "";
    expect((bodyRows.match(/<tr>/g) ?? []).length).toBe(2);
    expect(html).not.toContain("${");
    expect(html).not.toContain("undefined");
    expect(html).toContain("00-smoke/two-boxes");
  });

  it("escapes scene ids", () => {
    const report = reportWith([buildSceneResult("<x>&y", "auto", [])]);
    const html = renderReportHtml(report);
    expect(html).toContain("&lt;x&gt;&amp;y");
    expect(html).not.toContain("<x>&y");
  });
});

describe("renderStepSummary()", () => {
  it("summarizes counts and reports a clean run", () => {
    const report = reportWith([buildSceneResult("s1", "auto", [])]);
    const summary = renderStepSummary(report);
    expect(summary).toContain("1 scenes");
    expect(summary).toContain("No discrepancies found.");
    expect(summary).not.toContain("undefined");
  });
});
