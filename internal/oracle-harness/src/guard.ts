/**
 * Mechanical gate for the two autonomous PR kinds the pipeline opens:
 * `oracle-fix` (a converter fix) and `oracle-ledger` (a ledger-only note). It
 * is pure — the CLI wrapper (WS-3.2) feeds it a changed-file list and any
 * ledger status transitions computed from git — so every rule is unit-testable.
 *
 * The point is to make the ratchet ungameable: an autonomous PR may improve a
 * number only by fixing the converter, never by loosening a tolerance, editing
 * the measurement code, or un-parking a finding a human deliberately set aside.
 */

/** A pixel/severity tolerance change is a human calibration decision. */
const TOLERANCES_FILE = "internal/oracle-harness/src/tolerances.ts";
/** The measurement code itself: off-limits to any autonomous PR. */
const HARNESS_SRC = "internal/oracle-harness/src/";
/** Where repro scenes live; an oracle-fix must add at least one. */
const SCENES_DIR = "packages/dom-to-figma/scripts/oracle-scenes/";
const BASELINE_FILE = "internal/oracle-harness/baseline/scoreboard.json";
const KNOWN_FINDINGS = "internal/oracle-harness/known-findings/";

export type GuardLabel = "oracle-fix" | "oracle-ledger";

/** Git name-status: A(dd) M(odify) D(elete) R(ename); rename maps to the new path. */
export type FileStatus = "A" | "M" | "D" | "R";
export type ChangedFile = { path: string; status: FileStatus };

/** A ledger entry's status before → after this PR, for pre-existing entries.
 * A newly-added entry produces no flip (there was no prior status to protect). */
export type LedgerFlip = { class: string; from: string; to: string };

export type GuardInput = {
  label: GuardLabel;
  changedFiles: ReadonlyArray<ChangedFile>;
  ledgerFlips?: ReadonlyArray<LedgerFlip>;
};

export type GuardResult = { ok: boolean; violations: Array<string> };

/** An oracle-fix touches the converter, its repro scenes, the changeset, the
 * baseline it re-records, and the ledger it drains — but never the harness's
 * own measurement code. */
function isAllowedForFix(path: string): boolean {
  if (path.startsWith(HARNESS_SRC)) {
    return false;
  }
  return (
    path.startsWith("packages/") ||
    path.startsWith(".changeset/") ||
    path === BASELINE_FILE ||
    path.startsWith(KNOWN_FINDINGS)
  );
}

/** An oracle-ledger PR records analysis only: nothing outside the ledger dir. */
function isAllowedForLedger(path: string): boolean {
  return path.startsWith(KNOWN_FINDINGS);
}

/**
 * Validate an autonomous PR's diff against its label. Returns every violation
 * so the CI comment can list them all at once rather than one per push.
 */
export function checkGuard(input: GuardInput): GuardResult {
  const violations: Array<string> = [];
  const isAllowed =
    input.label === "oracle-fix" ? isAllowedForFix : isAllowedForLedger;

  for (const file of input.changedFiles) {
    if (file.path === TOLERANCES_FILE) {
      violations.push(
        `${TOLERANCES_FILE} may not be edited by an autonomous PR — moving a tolerance is a human calibration decision`
      );
      continue;
    }
    if (!isAllowed(file.path)) {
      violations.push(`${file.path} is outside the ${input.label} allowlist`);
    }
  }

  if (input.label === "oracle-fix") {
    const addedScene = input.changedFiles.some(
      (f) =>
        f.status === "A" &&
        f.path.startsWith(SCENES_DIR) &&
        f.path.endsWith(".html")
    );
    if (!addedScene) {
      violations.push(
        `an oracle-fix PR must add a repro scene under ${SCENES_DIR} — the fix is proven by a scene that goes clean`
      );
    }
  }

  for (const flip of input.ledgerFlips ?? []) {
    if (flip.from === "parked" && flip.to !== "parked") {
      violations.push(
        `ledger class '${flip.class}' flips parked→${flip.to} — only a human may un-park an entry`
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
