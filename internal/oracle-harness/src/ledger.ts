import type { Report } from "./report";

type LedgerStatus = "open" | "attempting" | "parked" | "resolved";

/** One discrepancy class's cross-run record. `body` is the human narrative
 * (Analysis / Attempts / Verdict) preserved verbatim across machine edits. */
export type LedgerEntry = {
  class: string;
  status: LedgerStatus;
  severity: number;
  firstSeenRun: string;
  lastSeenRun: string;
  lastAttemptRun: string | null;
  attempts: number;
  /** Run-counter value; while > the current run, ranking skips this class. */
  cooldownUntilRun: number | null;
  exemplarScene: string;
  exemplarFindingId: string;
  tier: 0 | 1 | 2;
  issue: number | null;
  body: string;
};

const STATUSES: ReadonlyArray<LedgerStatus> = [
  "open",
  "attempting",
  "parked",
  "resolved",
];

// Serialized in this order for stable, reviewable diffs.
const FIELD_ORDER = [
  "class",
  "status",
  "severity",
  "firstSeenRun",
  "lastSeenRun",
  "lastAttemptRun",
  "attempts",
  "cooldownUntilRun",
  "exemplarScene",
  "exemplarFindingId",
  "tier",
  "issue",
] as const;

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

const DEFAULT_BODY = `## Analysis
_TODO: why this discrepancy happens._

## Attempts

## Verdict
`;

function parseScalar(raw: string): string | number | null {
  if (raw === "null") {
    return null;
  }
  if (NUMERIC.test(raw)) {
    return Number(raw);
  }
  return raw.replace(/^"(.*)"$/, "$1");
}

function serializeScalar(value: string | number | null): string {
  return value === null ? "null" : String(value);
}

function isStatus(value: unknown): value is LedgerStatus {
  return STATUSES.includes(value as LedgerStatus);
}

/** Parse a ledger `.md` file into an entry. Throws on malformed frontmatter. */
export function parseEntry(markdown: string): LedgerEntry {
  const match = FRONTMATTER.exec(markdown);
  if (!match) {
    throw new Error("ledger entry: missing frontmatter");
  }
  const [, front, body] = match;
  const fields: Record<string, string | number | null> = {};
  for (const line of (front ?? "").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) {
      throw new Error(`ledger entry: malformed line '${line}'`);
    }
    fields[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1).trim());
  }

  if (!isStatus(fields.status)) {
    throw new Error(`ledger entry: bad status '${String(fields.status)}'`);
  }
  if (typeof fields.class !== "string") {
    throw new Error("ledger entry: missing class");
  }
  return {
    class: fields.class,
    status: fields.status,
    severity: Number(fields.severity ?? 0),
    firstSeenRun: String(fields.firstSeenRun ?? ""),
    lastSeenRun: String(fields.lastSeenRun ?? ""),
    lastAttemptRun:
      fields.lastAttemptRun === null ? null : String(fields.lastAttemptRun),
    attempts: Number(fields.attempts ?? 0),
    cooldownUntilRun:
      fields.cooldownUntilRun === null ? null : Number(fields.cooldownUntilRun),
    exemplarScene: String(fields.exemplarScene ?? ""),
    exemplarFindingId: String(fields.exemplarFindingId ?? ""),
    tier: Number(fields.tier ?? 0) as 0 | 1 | 2,
    issue: fields.issue === null ? null : Number(fields.issue),
    body: body ?? "",
  };
}

/** Serialize an entry back to `.md`, with a stable frontmatter key order. */
export function serializeEntry(entry: LedgerEntry): string {
  const record = entry as unknown as Record<string, string | number | null>;
  const lines = FIELD_ORDER.map(
    (key) => `${key}: ${serializeScalar(record[key] ?? null)}`
  );
  return `---\n${lines.join("\n")}\n---\n${entry.body}`;
}

function insertUnderSection(
  body: string,
  section: string,
  line: string
): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === section);
  if (start === -1) {
    return `${body.trimEnd()}\n\n${section}\n${line}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) {
    end += 1;
  }
  // Trim trailing blanks within the section, then append the line.
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]?.trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

function findingScene(
  report: Report,
  findingId: string
): { sceneId: string; tier: 0 | 1 | 2 } {
  const finding = report.findings.find((f) => f.id === findingId);
  return { sceneId: finding?.sceneId ?? "", tier: finding?.tier ?? 0 };
}

/**
 * Upsert the ledger from a report. New classes become `open`; recurring classes
 * refresh their metrics without touching status or body; classes absent from
 * the report are `resolved` (flagged for deletion) — except human-set `parked`
 * entries, which persist untouched.
 */
export function reconcile(
  entries: ReadonlyMap<string, LedgerEntry>,
  report: Report,
  run: { runId: string }
): { entries: Map<string, LedgerEntry>; resolved: Array<string> } {
  const next = new Map<string, LedgerEntry>(entries);
  const reportClasses = new Set(report.classes.map((c) => c.class));

  for (const rollup of report.classes) {
    const existing = next.get(rollup.class);
    const { sceneId, tier } = findingScene(report, rollup.exemplarFindingId);
    if (existing) {
      next.set(rollup.class, {
        ...existing,
        severity: rollup.aggregateSeverity,
        lastSeenRun: run.runId,
        exemplarFindingId: rollup.exemplarFindingId,
        exemplarScene: sceneId,
        tier,
      });
    } else {
      next.set(rollup.class, {
        class: rollup.class,
        status: "open",
        severity: rollup.aggregateSeverity,
        firstSeenRun: run.runId,
        lastSeenRun: run.runId,
        lastAttemptRun: null,
        attempts: 0,
        cooldownUntilRun: null,
        exemplarScene: sceneId,
        exemplarFindingId: rollup.exemplarFindingId,
        tier,
        issue: null,
        body: DEFAULT_BODY,
      });
    }
  }

  const resolved: Array<string> = [];
  for (const [cls, entry] of entries) {
    if (!reportClasses.has(cls) && entry.status !== "parked") {
      resolved.push(cls);
      next.delete(cls);
    }
  }

  return { entries: next, resolved };
}

/**
 * The highest-severity class the agent should work next: the report's ranked
 * classes minus those that are parked, mid-attempt, or still cooling down.
 * Returns null when nothing is eligible.
 */
export function selectNextClass(
  report: Report,
  entries: ReadonlyMap<string, LedgerEntry>,
  runCounter: number
): string | null {
  for (const rollup of report.classes) {
    const entry = entries.get(rollup.class);
    if (!entry) {
      return rollup.class;
    }
    if (entry.status === "parked" || entry.status === "attempting") {
      continue;
    }
    if (
      entry.cooldownUntilRun !== null &&
      entry.cooldownUntilRun > runCounter
    ) {
      continue;
    }
    return rollup.class;
  }
  return null;
}

/** Park a class with a verdict (permanent: excluded from fix work). */
export function park(entry: LedgerEntry, verdict: string): LedgerEntry {
  if (verdict.trim() === "") {
    throw new Error("park requires a non-empty verdict");
  }
  return {
    ...entry,
    status: "parked",
    body: insertUnderSection(entry.body, "## Verdict", verdict.trim()),
  };
}

/** Record a failed fix attempt, optionally backing off for N runs. */
export function recordAttempt(
  entry: LedgerEntry,
  attempt: {
    runId: string;
    whatTried: string;
    whyFailed: string;
    runCounter: number;
    cooldownRuns?: number;
  }
): LedgerEntry {
  const line = `- run ${attempt.runId}: ${attempt.whatTried} → ${attempt.whyFailed}`;
  return {
    ...entry,
    status: "open",
    attempts: entry.attempts + 1,
    lastAttemptRun: attempt.runId,
    cooldownUntilRun:
      attempt.cooldownRuns === undefined
        ? entry.cooldownUntilRun
        : attempt.runCounter + attempt.cooldownRuns,
    body: insertUnderSection(entry.body, "## Attempts", line),
  };
}
