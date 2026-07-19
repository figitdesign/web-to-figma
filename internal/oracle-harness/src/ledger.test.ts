import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "./ledger";
import {
  park,
  parseEntry,
  reconcile,
  recordAttempt,
  selectNextClass,
  serializeEntry,
} from "./ledger";
import type { ClassRollup, Report, ReportFinding } from "./report";

const STATUS_ERR = /status/;
const VERDICT_ERR = /verdict/;

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    class: "geometry.x",
    status: "open",
    severity: 0.5,
    firstSeenRun: "r1",
    lastSeenRun: "r1",
    lastAttemptRun: null,
    attempts: 0,
    cooldownUntilRun: null,
    exemplarScene: "s1",
    exemplarFindingId: "abc123def456",
    tier: 0,
    issue: null,
    body: "## Analysis\nwhy\n\n## Attempts\n\n## Verdict\n",
    ...overrides,
  };
}

function rollup(overrides: Partial<ClassRollup> = {}): ClassRollup {
  return {
    class: "geometry.x",
    count: 1,
    scenes: ["s1"],
    aggregateSeverity: 0.5,
    exemplarFindingId: "abc123def456",
    ...overrides,
  };
}

function report(classes: Array<ClassRollup>): Report {
  const findings: Array<ReportFinding> = classes.map((c) => ({
    id: c.exemplarFindingId,
    sceneId: c.scenes[0] ?? "s1",
    tier: 0,
    class: c.class as ReportFinding["class"],
    severity: c.aggregateSeverity,
  }));
  return {
    schemaVersion: 1,
    runId: "r2",
    commit: "c",
    createdAt: "t",
    tiersRun: [0],
    scenes: [],
    findings,
    classes,
  };
}

describe("parse/serialize round-trip", () => {
  it("is byte-stable", () => {
    const text = serializeEntry(entry());
    expect(serializeEntry(parseEntry(text))).toBe(text);
  });

  it("preserves null fields and the body", () => {
    const parsed = parseEntry(serializeEntry(entry({ cooldownUntilRun: 4 })));
    expect(parsed.cooldownUntilRun).toBe(4);
    expect(parsed.lastAttemptRun).toBeNull();
    expect(parsed.body).toContain("## Attempts");
  });

  it("rejects a bad status", () => {
    const text = serializeEntry(entry()).replace("open", "sideways");
    expect(() => parseEntry(text)).toThrow(STATUS_ERR);
  });
});

describe("reconcile()", () => {
  it("creates an open entry for a new class", () => {
    const { entries } = reconcile(new Map(), report([rollup()]), {
      runId: "r2",
    });
    const created = entries.get("geometry.x");
    expect(created?.status).toBe("open");
    expect(created?.firstSeenRun).toBe("r2");
  });

  it("refreshes a recurring class without touching status or body", () => {
    const existing = new Map([["geometry.x", entry({ severity: 0.1 })]]);
    const { entries } = reconcile(
      existing,
      report([rollup({ aggregateSeverity: 0.9 })]),
      { runId: "r2" }
    );
    const updated = entries.get("geometry.x");
    expect(updated?.severity).toBe(0.9);
    expect(updated?.lastSeenRun).toBe("r2");
    expect(updated?.body).toBe(entry().body);
  });

  it("resolves and deletes a class gone from the report", () => {
    const existing = new Map([["geometry.x", entry()]]);
    const { entries, resolved } = reconcile(existing, report([]), {
      runId: "r2",
    });
    expect(resolved).toEqual(["geometry.x"]);
    expect(entries.has("geometry.x")).toBe(false);
  });

  it("keeps a parked class that reappears in the report parked", () => {
    const existing = new Map([["geometry.x", entry({ status: "parked" })]]);
    const { entries } = reconcile(existing, report([rollup()]), {
      runId: "r2",
    });
    expect(entries.get("geometry.x")?.status).toBe("parked");
  });

  it("does not resolve a parked class that is absent from the report", () => {
    const existing = new Map([["geometry.x", entry({ status: "parked" })]]);
    const { entries, resolved } = reconcile(existing, report([]), {
      runId: "r2",
    });
    expect(resolved).toHaveLength(0);
    expect(entries.get("geometry.x")?.status).toBe("parked");
  });
});

describe("selectNextClass()", () => {
  const ranked = report([
    rollup({ class: "geometry.y", aggregateSeverity: 0.9 }),
    rollup({ class: "geometry.x", aggregateSeverity: 0.5 }),
  ]);

  it("returns the highest-severity eligible class", () => {
    expect(selectNextClass(ranked, new Map(), 0)).toBe("geometry.y");
  });

  it("skips parked and attempting classes", () => {
    const entries = new Map([
      ["geometry.y", entry({ class: "geometry.y", status: "parked" })],
    ]);
    expect(selectNextClass(ranked, entries, 0)).toBe("geometry.x");
  });

  it("skips a class still cooling down but not one whose cooldown passed", () => {
    const cooling = new Map([
      ["geometry.y", entry({ class: "geometry.y", cooldownUntilRun: 5 })],
    ]);
    expect(selectNextClass(ranked, cooling, 3)).toBe("geometry.x");
    expect(selectNextClass(ranked, cooling, 5)).toBe("geometry.y");
  });

  it("returns null when everything is excluded", () => {
    const entries = new Map([
      ["geometry.y", entry({ class: "geometry.y", status: "parked" })],
      ["geometry.x", entry({ class: "geometry.x", status: "parked" })],
    ]);
    expect(selectNextClass(ranked, entries, 0)).toBeNull();
  });
});

describe("park() and recordAttempt()", () => {
  it("park rejects an empty verdict", () => {
    expect(() => park(entry(), "   ")).toThrow(VERDICT_ERR);
  });

  it("park sets status and appends the verdict", () => {
    const parked = park(entry(), "Figma can't represent this");
    expect(parked.status).toBe("parked");
    expect(parked.body).toContain("Figma can't represent this");
  });

  it("recordAttempt increments, logs, and can set a cooldown", () => {
    const attempted = recordAttempt(entry(), {
      runId: "r5",
      whatTried: "forced pixels",
      whyFailed: "Figma overrode",
      runCounter: 10,
      cooldownRuns: 3,
    });
    expect(attempted.attempts).toBe(1);
    expect(attempted.status).toBe("open");
    expect(attempted.lastAttemptRun).toBe("r5");
    expect(attempted.cooldownUntilRun).toBe(13);
    expect(attempted.body).toContain("forced pixels → Figma overrode");
  });
});
