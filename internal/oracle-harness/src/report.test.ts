import { describe, expect, it } from "vitest";
import type { Finding } from "./findings";
import type { ReportFinding } from "./report";
import {
  assertReport,
  buildReport,
  buildSceneResult,
  findingId,
  rankClasses,
} from "./report";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    sceneId: "s1",
    tier: 0,
    class: "geometry.x",
    severity: 0.5,
    domPath: ":scope > div:nth-child(1)",
    field: "x",
    ...overrides,
  };
}

function reportFinding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  const base = finding(overrides);
  return { ...base, id: overrides.id ?? findingId(base) };
}

const META = {
  runId: "r1",
  commit: "abc123",
  createdAt: "2026-07-19T00:00:00Z",
};

const ID_HEX = /^[0-9a-f]{12}$/;
const SCHEMA_VERSION_ERR = /schemaVersion/;
const LAYOUT_ERR = /scenes\[0]\.layout/;

describe("findingId()", () => {
  it("is stable for the same logical finding regardless of severity/delta", () => {
    const a = finding({ severity: 0.5, deltaPx: 4 });
    const b = finding({ severity: 0.9, deltaPx: 8 });
    expect(findingId(a)).toBe(findingId(b));
  });

  it("changes when an identifying field changes", () => {
    expect(findingId(finding({ field: "x" }))).not.toBe(
      findingId(finding({ field: "y", class: "geometry.y" }))
    );
  });
});

describe("buildSceneResult()", () => {
  it("counts findings and tracks the max delta", () => {
    const result = buildSceneResult("s1", "auto", [
      finding({ deltaPx: 2 }),
      finding({ deltaPx: 5, class: "geometry.y", field: "y" }),
      finding({ class: "node.missing", deltaPx: undefined }),
    ]);
    expect(result.tier0.findings).toBe(3);
    expect(result.tier0.maxDeltaPx).toBe(5);
  });
});

describe("rankClasses()", () => {
  it("ranks classes by aggregate severity and picks the cleanest exemplar", () => {
    const findings: Array<ReportFinding> = [
      // class A: two findings, aggregate severity 1.1
      reportFinding({ sceneId: "busy", class: "geometry.x", severity: 0.6 }),
      reportFinding({
        sceneId: "clean",
        class: "geometry.x",
        field: "width",
        severity: 0.5,
      }),
      // class B: one finding, aggregate severity 0.9
      reportFinding({ sceneId: "busy", class: "geometry.y", severity: 0.9 }),
      // extra finding making `busy` the busier scene
      reportFinding({
        sceneId: "busy",
        class: "node.missing",
        severity: 0.1,
      }),
    ];
    const classes = rankClasses(findings);
    expect(classes.map((c) => c.class)).toEqual([
      "geometry.x",
      "geometry.y",
      "node.missing",
    ]);
    const geomX = classes.find((c) => c.class === "geometry.x");
    // exemplar should come from `clean` (fewer total findings than `busy`).
    const exemplar = findings.find((f) => f.id === geomX?.exemplarFindingId);
    expect(exemplar?.sceneId).toBe("clean");
  });
});

describe("buildReport()", () => {
  it("assigns ids and ranks classes", () => {
    const report = buildReport({
      ...META,
      tiersRun: [0],
      scenes: [buildSceneResult("s1", "auto", [finding()])],
      rawFindings: [finding()],
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.id).toMatch(ID_HEX);
    expect(report.classes[0]?.class).toBe("geometry.x");
  });
});

describe("assertReport()", () => {
  it("accepts a valid report", () => {
    const report = buildReport({
      ...META,
      tiersRun: [0],
      scenes: [],
      rawFindings: [],
    });
    expect(() => assertReport(report)).not.toThrow();
  });

  it("rejects a wrong schemaVersion with a path", () => {
    expect(() => assertReport({ schemaVersion: 2 })).toThrow(
      SCHEMA_VERSION_ERR
    );
  });

  it("rejects a bad scene layout with a path", () => {
    const bad = {
      schemaVersion: 1,
      runId: "r",
      commit: "c",
      createdAt: "t",
      tiersRun: [0],
      scenes: [{ sceneId: "s", layout: "diagonal", tier0: { findings: 0 } }],
      findings: [],
      classes: [],
    };
    expect(() => assertReport(bad)).toThrow(LAYOUT_ERR);
  });
});
