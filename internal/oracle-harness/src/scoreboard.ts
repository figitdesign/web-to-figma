import type { Report } from "./report";

const SCOREBOARD_SCHEMA_VERSION = 1;
/** A scene may drift this far on maxDeltaPx before it counts as a regression. */
const MAX_DELTA_EPSILON_PX = 0.25;
/** tier-2 render noise floor; recalibrated in WS-2.6. */
const DIFF_RATIO_EPSILON = 0.002;

export type SceneScore = {
  tier0: { findings: number; maxDeltaPx: number };
  tier1?: { findings: number; maxDeltaPx: number };
  tier2?: { diffRatio: number };
};

export type Scoreboard = {
  schemaVersion: number;
  scenes: Record<string, SceneScore>;
};

/** Project a report down to the committed metrics the ratchet tracks. */
export function buildScoreboard(report: Report): Scoreboard {
  const scenes: Record<string, SceneScore> = {};
  for (const scene of report.scenes) {
    const score: SceneScore = {
      tier0: {
        findings: scene.tier0.findings,
        maxDeltaPx: scene.tier0.maxDeltaPx,
      },
    };
    if (scene.tier1) {
      score.tier1 = {
        findings: scene.tier1.findings,
        maxDeltaPx: scene.tier1.maxDeltaPx,
      };
    }
    if (scene.tier2) {
      score.tier2 = { diffRatio: scene.tier2.diffRatio };
    }
    scenes[scene.sceneId] = score;
  }
  return { schemaVersion: SCOREBOARD_SCHEMA_VERSION, scenes };
}

type CheckIssue = { sceneId: string; metric: string; detail: string };
export type CheckResult = {
  ok: boolean;
  regressions: Array<CheckIssue>;
  improvements: Array<CheckIssue>;
};

function compareScene(
  sceneId: string,
  current: SceneScore,
  baseline: SceneScore,
  regressions: Array<CheckIssue>,
  improvements: Array<CheckIssue>
): void {
  const dFindings = current.tier0.findings - baseline.tier0.findings;
  if (dFindings > 0) {
    regressions.push({
      sceneId,
      metric: "tier0.findings",
      detail: `${baseline.tier0.findings} → ${current.tier0.findings}`,
    });
  } else if (dFindings < 0) {
    improvements.push({
      sceneId,
      metric: "tier0.findings",
      detail: `${baseline.tier0.findings} → ${current.tier0.findings}`,
    });
  }

  const dDelta = current.tier0.maxDeltaPx - baseline.tier0.maxDeltaPx;
  if (dDelta > MAX_DELTA_EPSILON_PX) {
    regressions.push({
      sceneId,
      metric: "tier0.maxDeltaPx",
      detail: `${baseline.tier0.maxDeltaPx.toFixed(2)} → ${current.tier0.maxDeltaPx.toFixed(2)}`,
    });
  } else if (-dDelta > MAX_DELTA_EPSILON_PX) {
    improvements.push({
      sceneId,
      metric: "tier0.maxDeltaPx",
      detail: `${baseline.tier0.maxDeltaPx.toFixed(2)} → ${current.tier0.maxDeltaPx.toFixed(2)}`,
    });
  }

  if (current.tier1 && baseline.tier1) {
    const d = current.tier1.findings - baseline.tier1.findings;
    if (d > 0) {
      regressions.push({
        sceneId,
        metric: "tier1.findings",
        detail: `${baseline.tier1.findings} → ${current.tier1.findings}`,
      });
    } else if (d < 0) {
      improvements.push({
        sceneId,
        metric: "tier1.findings",
        detail: `${baseline.tier1.findings} → ${current.tier1.findings}`,
      });
    }
  }

  if (current.tier2 && baseline.tier2) {
    const d = current.tier2.diffRatio - baseline.tier2.diffRatio;
    if (d > DIFF_RATIO_EPSILON) {
      regressions.push({
        sceneId,
        metric: "tier2.diffRatio",
        detail: `${baseline.tier2.diffRatio.toFixed(4)} → ${current.tier2.diffRatio.toFixed(4)}`,
      });
    } else if (-d > DIFF_RATIO_EPSILON) {
      improvements.push({
        sceneId,
        metric: "tier2.diffRatio",
        detail: `${baseline.tier2.diffRatio.toFixed(4)} → ${current.tier2.diffRatio.toFixed(4)}`,
      });
    }
  }
}

/**
 * Compare a run's scoreboard against the committed baseline. A run may only
 * hold or improve every metric; any increase — or an added/removed scene not
 * reconciled in the same PR — is a regression.
 */
export function checkScoreboard(
  current: Scoreboard,
  baseline: Scoreboard
): CheckResult {
  const regressions: Array<CheckIssue> = [];
  const improvements: Array<CheckIssue> = [];

  for (const sceneId of Object.keys(baseline.scenes)) {
    if (!(sceneId in current.scenes)) {
      regressions.push({
        sceneId,
        metric: "scene",
        detail:
          "in baseline but missing from run — remove it from the baseline in this PR",
      });
    }
  }

  for (const sceneId of Object.keys(current.scenes)) {
    const cur = current.scenes[sceneId];
    const base = baseline.scenes[sceneId];
    if (!cur) {
      continue;
    }
    if (!base) {
      regressions.push({
        sceneId,
        metric: "scene",
        detail:
          "new scene absent from baseline — add it via `check --update` in this PR",
      });
      continue;
    }
    compareScene(sceneId, cur, base, regressions, improvements);
  }

  return { ok: regressions.length === 0, regressions, improvements };
}

/** Serialize a scoreboard with scene keys sorted, for minimal, reviewable diffs. */
export function serializeScoreboard(scoreboard: Scoreboard): string {
  const scenes: Record<string, SceneScore> = {};
  for (const id of Object.keys(scoreboard.scenes).sort()) {
    const score = scoreboard.scenes[id];
    if (score) {
      scenes[id] = score;
    }
  }
  return `${JSON.stringify({ schemaVersion: scoreboard.schemaVersion, scenes }, null, 2)}\n`;
}
