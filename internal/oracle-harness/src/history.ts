import type { Report } from "./report";

/**
 * One line of run history (WS-3.3). Kept intentionally tiny — a rolling
 * `runs.ndjson` artifact, not a database — so a human can eyeball whether the
 * fleet is trending toward parity across scheduled runs. Revisit only if N grows.
 */
export type RunHistoryRecord = {
  runId: string;
  commit: string;
  createdAt: string;
  scenes: number;
  totalFindings: number;
  /** Median tier-2 diffRatio across scenes that were rendered; 0 if none. */
  medianDiffRatio: number;
  /** The run's three highest-severity discrepancy classes, in rank order. */
  classesTop3: Array<string>;
};

const TOP_N = 3;

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Project a full report down to a single history record. */
export function summarizeRun(report: Report): RunHistoryRecord {
  const diffRatios = report.scenes
    .map((s) => s.tier2?.diffRatio)
    .filter((r): r is number => r !== undefined);
  return {
    runId: report.runId,
    commit: report.commit,
    createdAt: report.createdAt,
    scenes: report.scenes.length,
    totalFindings: report.findings.length,
    medianDiffRatio: median(diffRatios),
    classesTop3: report.classes.slice(0, TOP_N).map((c) => c.class),
  };
}

/** Serialize a record as one NDJSON line (trailing newline included). */
export function serializeHistoryLine(record: RunHistoryRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/** A one-line, human-readable rendering for the workflow step summary. */
export function renderHistoryLine(record: RunHistoryRecord): string {
  const top =
    record.classesTop3.length > 0 ? record.classesTop3.join(", ") : "—";
  return `\`${record.runId}\` @ ${record.commit.slice(0, 7)}: ${record.totalFindings} findings across ${record.scenes} scenes, median tier-2 ${(record.medianDiffRatio * 100).toFixed(2)}% — top: ${top}`;
}
