import { describe, expect, it } from "vitest";
import type { SceneScore, Scoreboard } from "./scoreboard";
import {
  checkScoreboard,
  serializeScoreboard,
  updateBaseline,
} from "./scoreboard";

function board(scenes: Record<string, SceneScore>): Scoreboard {
  return { schemaVersion: 1, scenes };
}

const CLEAN: SceneScore = { tier0: { findings: 0, maxDeltaPx: 0 } };

describe("checkScoreboard()", () => {
  it("passes when metrics hold steady", () => {
    const result = checkScoreboard(board({ a: CLEAN }), board({ a: CLEAN }));
    expect(result.ok).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it("fails when tier0 findings increase, naming scene and metric", () => {
    const result = checkScoreboard(
      board({ a: { tier0: { findings: 2, maxDeltaPx: 0 } } }),
      board({ a: CLEAN })
    );
    expect(result.ok).toBe(false);
    expect(result.regressions).toEqual([
      { sceneId: "a", metric: "tier0.findings", detail: "0 → 2" },
    ]);
  });

  it("reports a findings decrease as an improvement", () => {
    const result = checkScoreboard(
      board({ a: CLEAN }),
      board({ a: { tier0: { findings: 3, maxDeltaPx: 0 } } })
    );
    expect(result.ok).toBe(true);
    expect(result.improvements[0]).toMatchObject({ metric: "tier0.findings" });
  });

  it("applies the maxDeltaPx epsilon", () => {
    const base = board({ a: { tier0: { findings: 0, maxDeltaPx: 1 } } });
    const within = board({ a: { tier0: { findings: 0, maxDeltaPx: 1.2 } } });
    const beyond = board({ a: { tier0: { findings: 0, maxDeltaPx: 1.3 } } });
    expect(checkScoreboard(within, base).ok).toBe(true);
    expect(checkScoreboard(beyond, base).ok).toBe(false);
  });

  it("applies the tier2 diffRatio epsilon", () => {
    const base = board({ a: { ...CLEAN, tier2: { diffRatio: 0.01 } } });
    const beyond = board({ a: { ...CLEAN, tier2: { diffRatio: 0.013 } } });
    expect(checkScoreboard(beyond, base).ok).toBe(false);
  });

  it("flags a scene present in the baseline but missing from the run", () => {
    const result = checkScoreboard(board({}), board({ a: CLEAN }));
    expect(result.ok).toBe(false);
    expect(result.regressions[0]).toMatchObject({
      sceneId: "a",
      metric: "scene",
    });
  });

  it("flags a new scene absent from the baseline", () => {
    const result = checkScoreboard(board({ a: CLEAN }), board({}));
    expect(result.ok).toBe(false);
    expect(result.regressions[0]?.detail).toContain("add it");
  });
});

describe("serializeScoreboard()", () => {
  it("sorts scene keys and ends with a newline", () => {
    const json = serializeScoreboard(
      board({ zed: CLEAN, alpha: CLEAN, mid: CLEAN })
    );
    const order = [...json.matchAll(/"(alpha|mid|zed)":/g)].map((m) => m[1]);
    expect(order).toEqual(["alpha", "mid", "zed"]);
    expect(json.endsWith("}\n")).toBe(true);
  });
});

describe("updateBaseline()", () => {
  const FULL: SceneScore = {
    tier0: { findings: 0, maxDeltaPx: 0 },
    tier1: { findings: 1, maxDeltaPx: 0.4 },
    tier2: { diffRatio: 0.01 },
  };

  it("preserves tiers the run did not measure", () => {
    // A tier-0-only run must not erase the committed tier-1/2 entries.
    const next = updateBaseline(board({ a: CLEAN }), board({ a: FULL }));
    expect(next.scenes.a).toEqual(FULL);
  });

  it("overwrites tiers the run did measure", () => {
    const next = updateBaseline(
      board({ a: { ...CLEAN, tier2: { diffRatio: 0.002 } } }),
      board({ a: FULL })
    );
    expect(next.scenes.a?.tier2).toEqual({ diffRatio: 0.002 });
    expect(next.scenes.a?.tier1).toEqual(FULL.tier1);
  });

  it("adds new scenes with only the tiers measured", () => {
    const next = updateBaseline(board({ b: CLEAN }), board({ a: FULL }));
    expect(next.scenes.b).toEqual(CLEAN);
  });

  it("drops scenes absent from the run and handles a missing baseline", () => {
    expect(
      updateBaseline(board({ b: CLEAN }), board({ a: FULL })).scenes.a
    ).toBeUndefined();
    expect(updateBaseline(board({ b: CLEAN }), null).scenes.b).toEqual(CLEAN);
  });
});
