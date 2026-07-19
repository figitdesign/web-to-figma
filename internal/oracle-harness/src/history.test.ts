import { describe, expect, it } from "vitest";
import {
  renderHistoryLine,
  serializeHistoryLine,
  summarizeRun,
} from "./history";
import type { Report, SceneResult } from "./report";

function scene(id: string, diffRatio?: number): SceneResult {
  const s: SceneResult = {
    sceneId: id,
    layout: "auto",
    tier0: { findings: 0, maxDeltaPx: 0 },
  };
  if (diffRatio !== undefined) {
    s.tier2 = { diffRatio, clusters: 0 };
  }
  return s;
}

function report(over: Partial<Report>): Report {
  return {
    schemaVersion: 1,
    runId: "run-1",
    commit: "abcdef1234567890",
    createdAt: "2026-07-19T00:00:00.000Z",
    tiersRun: [0, 1, 2],
    scenes: [],
    findings: [],
    classes: [],
    ...over,
  };
}

describe("summarizeRun()", () => {
  it("takes the median diffRatio of rendered scenes", () => {
    const r = summarizeRun(
      report({ scenes: [scene("a", 0.01), scene("b", 0.03), scene("c", 0.05)] })
    );
    expect(r.medianDiffRatio).toBeCloseTo(0.03);
    expect(r.scenes).toBe(3);
  });

  it("averages the two middle values for an even count", () => {
    const r = summarizeRun(
      report({ scenes: [scene("a", 0.02), scene("b", 0.04)] })
    );
    expect(r.medianDiffRatio).toBeCloseTo(0.03);
  });

  it("ignores scenes without tier-2 and defaults to 0", () => {
    const r = summarizeRun(report({ scenes: [scene("a"), scene("b")] }));
    expect(r.medianDiffRatio).toBe(0);
  });

  it("carries the top three classes in rank order", () => {
    const r = summarizeRun(
      report({
        classes: [
          {
            class: "pixel.region",
            count: 5,
            scenes: [],
            aggregateSeverity: 3,
            exemplarFindingId: "x",
          },
          {
            class: "geometry.x",
            count: 2,
            scenes: [],
            aggregateSeverity: 2,
            exemplarFindingId: "y",
          },
          {
            class: "stroke.width",
            count: 1,
            scenes: [],
            aggregateSeverity: 1,
            exemplarFindingId: "z",
          },
          {
            class: "radius.topLeft",
            count: 1,
            scenes: [],
            aggregateSeverity: 0.5,
            exemplarFindingId: "w",
          },
        ],
      })
    );
    expect(r.classesTop3).toEqual([
      "pixel.region",
      "geometry.x",
      "stroke.width",
    ]);
  });
});

describe("serializeHistoryLine()", () => {
  it("emits valid single-line JSON with a trailing newline", () => {
    const line = serializeHistoryLine(summarizeRun(report({})));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      runId: "run-1",
      totalFindings: 0,
    });
  });
});

describe("renderHistoryLine()", () => {
  it("renders a short commit and dash for no classes", () => {
    const text = renderHistoryLine(summarizeRun(report({})));
    expect(text).toContain("abcdef1");
    expect(text).toContain("top: —");
  });
});
