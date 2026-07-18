import { createHash } from "node:crypto";
import type { Finding } from "./findings";

/** A finding with its stable content-hash id assigned. */
export type ReportFinding = Finding & { id: string };

export type SceneResult = {
  sceneId: string;
  layout: "auto" | "absolute";
  tier0: { findings: number; maxDeltaPx: number };
  tier1?: { findings: number; maxDeltaPx: number };
  tier2?: { diffRatio: number; clusters: number };
  error?: string;
};

export type ClassRollup = {
  class: string;
  count: number;
  scenes: Array<string>;
  aggregateSeverity: number;
  exemplarFindingId: string;
};

export type Report = {
  schemaVersion: 1;
  runId: string;
  commit: string;
  createdAt: string;
  tiersRun: Array<0 | 1 | 2>;
  scenes: Array<SceneResult>;
  findings: Array<ReportFinding>;
  classes: Array<ClassRollup>;
};

const REPORT_SCHEMA_VERSION = 1;
const ID_HEX_LENGTH = 12;

/**
 * Stable id for a finding: a content hash of the fields that identify it, so
 * the same logical discrepancy keeps the same id across runs. Independent of
 * severity/delta (which drift run-to-run).
 */
export function findingId(finding: Finding): string {
  const key = [
    finding.sceneId,
    finding.domPath ?? finding.guid ?? "",
    finding.class,
    finding.field ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, ID_HEX_LENGTH);
}

/** Per-scene tier-0 rollup derived from that scene's raw findings. */
export function buildSceneResult(
  sceneId: string,
  layout: "auto" | "absolute",
  findings: ReadonlyArray<Finding>
): SceneResult {
  let maxDeltaPx = 0;
  for (const finding of findings) {
    if (finding.deltaPx !== undefined && finding.deltaPx > maxDeltaPx) {
      maxDeltaPx = finding.deltaPx;
    }
  }
  return {
    sceneId,
    layout,
    tier0: { findings: findings.length, maxDeltaPx },
  };
}

/**
 * Group findings into per-class rollups, ranked by aggregate severity (desc).
 * The exemplar is the finding whose scene has the fewest total findings — the
 * cleanest repro to hand the fixing agent — with a stable id tie-break.
 */
export function rankClasses(
  findings: ReadonlyArray<ReportFinding>
): Array<ClassRollup> {
  const perScene = new Map<string, number>();
  for (const finding of findings) {
    perScene.set(finding.sceneId, (perScene.get(finding.sceneId) ?? 0) + 1);
  }

  const byClass = new Map<string, Array<ReportFinding>>();
  for (const finding of findings) {
    const bucket = byClass.get(finding.class) ?? [];
    bucket.push(finding);
    byClass.set(finding.class, bucket);
  }

  const rollups: Array<ClassRollup> = [];
  for (const [cls, group] of byClass) {
    const scenes = [...new Set(group.map((f) => f.sceneId))].sort();
    const aggregateSeverity = group.reduce((n, f) => n + f.severity, 0);
    const exemplar = [...group].sort((a, b) => {
      const byCount =
        (perScene.get(a.sceneId) ?? 0) - (perScene.get(b.sceneId) ?? 0);
      return byCount === 0 ? a.id.localeCompare(b.id) : byCount;
    })[0];
    rollups.push({
      class: cls,
      count: group.length,
      scenes,
      aggregateSeverity,
      exemplarFindingId: exemplar?.id ?? "",
    });
  }

  rollups.sort(
    (a, b) =>
      b.aggregateSeverity - a.aggregateSeverity ||
      a.class.localeCompare(b.class)
  );
  return rollups;
}

/** Assemble a full report: assign finding ids, rank classes, stamp metadata. */
export function buildReport(input: {
  runId: string;
  commit: string;
  createdAt: string;
  tiersRun: Array<0 | 1 | 2>;
  scenes: Array<SceneResult>;
  rawFindings: ReadonlyArray<Finding>;
}): Report {
  const findings: Array<ReportFinding> = input.rawFindings.map((finding) => ({
    ...finding,
    id: findingId(finding),
  }));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runId: input.runId,
    commit: input.commit,
    createdAt: input.createdAt,
    tiersRun: input.tiersRun,
    scenes: input.scenes,
    findings,
    classes: rankClasses(findings),
  };
}

function fail(path: string, message: string): never {
  throw new Error(`invalid report at ${path}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertScene(value: unknown, path: string): void {
  if (!isObject(value)) {
    fail(path, "expected object");
  }
  if (typeof value.sceneId !== "string") {
    fail(`${path}.sceneId`, "expected string");
  }
  if (value.layout !== "auto" && value.layout !== "absolute") {
    fail(`${path}.layout`, "expected 'auto' | 'absolute'");
  }
  if (!isObject(value.tier0) || typeof value.tier0.findings !== "number") {
    fail(`${path}.tier0.findings`, "expected number");
  }
}

/** Throw a path-specific error if `value` is not a well-formed {@link Report}. */
export function assertReport(value: unknown): asserts value is Report {
  if (!isObject(value)) {
    fail("(root)", "expected object");
  }
  if (value.schemaVersion !== REPORT_SCHEMA_VERSION) {
    fail("schemaVersion", `expected ${REPORT_SCHEMA_VERSION}`);
  }
  for (const key of ["runId", "commit", "createdAt"] as const) {
    if (typeof value[key] !== "string") {
      fail(key, "expected string");
    }
  }
  if (!Array.isArray(value.scenes)) {
    fail("scenes", "expected array");
  }
  const scenes = value.scenes as Array<unknown>;
  for (let i = 0; i < scenes.length; i++) {
    assertScene(scenes[i], `scenes[${i}]`);
  }
  if (!Array.isArray(value.findings)) {
    fail("findings", "expected array");
  }
  if (!Array.isArray(value.classes)) {
    fail("classes", "expected array");
  }
}
