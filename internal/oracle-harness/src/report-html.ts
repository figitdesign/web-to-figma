import type { Report } from "./report";

const TOP_CLASSES = 5;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A self-contained HTML report (no framework, no external assets) suitable
 * for uploading as a CI artifact. */
export function renderReportHtml(report: Report): string {
  const sceneRows = report.scenes
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.sceneId)}</td><td>${s.layout}</td><td>${s.tier0.findings}</td><td>${s.tier0.maxDeltaPx.toFixed(2)}</td></tr>`
    )
    .join("\n");
  const classRows = report.classes
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.class)}</td><td>${c.count}</td><td>${c.aggregateSeverity.toFixed(2)}</td><td>${escapeHtml(c.scenes.join(", "))}</td></tr>`
    )
    .join("\n");
  const classSection =
    report.classes.length > 0
      ? `<h2>Discrepancy classes</h2>
<table><thead><tr><th>class</th><th>count</th><th>Σ severity</th><th>scenes</th></tr></thead>
<tbody>${classRows}</tbody></table>`
      : "<p>No discrepancies found.</p>";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Parity report ${escapeHtml(report.runId)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #18181b; }
  h1 { font-size: 18px; } h2 { font-size: 15px; margin-top: 28px; }
  .meta { color: #71717a; font-size: 13px; }
  table { border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #e4e4e7; padding: 4px 10px; text-align: left; }
  th { background: #fafafa; }
</style></head><body>
<h1>Parity report</h1>
<p class="meta">run ${escapeHtml(report.runId)} · commit ${escapeHtml(report.commit)} · ${escapeHtml(report.createdAt)} · tiers ${report.tiersRun.join(", ")}</p>
<p class="meta">${report.scenes.length} scenes · ${report.findings.length} findings</p>
${classSection}
<h2>Scenes</h2>
<table><thead><tr><th>scene</th><th>layout</th><th>tier-0 findings</th><th>max Δpx</th></tr></thead>
<tbody>${sceneRows}</tbody></table>
</body></html>
`;
}

/** Compact GitHub Actions step-summary markdown. */
export function renderStepSummary(report: Report): string {
  const lines = [
    `## Parity report — ${report.runId}`,
    "",
    `commit \`${report.commit}\` · ${report.scenes.length} scenes · ${report.findings.length} findings`,
    "",
  ];
  if (report.classes.length > 0) {
    lines.push(
      "| class | count | Σ severity | scenes |",
      "| --- | --- | --- | --- |",
      ...report.classes
        .slice(0, TOP_CLASSES)
        .map(
          (c) =>
            `| ${c.class} | ${c.count} | ${c.aggregateSeverity.toFixed(2)} | ${c.scenes.length} |`
        )
    );
  } else {
    lines.push("No discrepancies found.");
  }
  return `${lines.join("\n")}\n`;
}
