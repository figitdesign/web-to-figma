import { describe, expect, it } from "vitest";
import type { ChangedFile, GuardInput } from "./guard";
import { checkGuard } from "./guard";

const A = (path: string): ChangedFile => ({ path, status: "A" });
const M = (path: string): ChangedFile => ({ path, status: "M" });

/** A minimal, valid oracle-fix diff: a converter change, its repro scene, a
 * changeset, and the re-recorded baseline. */
const VALID_FIX: ReadonlyArray<ChangedFile> = [
  M("packages/dom-to-figma/src/converter/nodes/frame/converter.ts"),
  A("packages/dom-to-figma/scripts/oracle-scenes/06-repro/skew.html"),
  A(".changeset/fix-skew.md"),
  M("internal/oracle-harness/baseline/scoreboard.json"),
];

function fix(changedFiles: ReadonlyArray<ChangedFile>): GuardInput {
  return { label: "oracle-fix", changedFiles };
}

describe("checkGuard() — oracle-fix", () => {
  it("passes a well-formed converter fix", () => {
    const result = checkGuard(fix(VALID_FIX));
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("rejects editing the tolerances file", () => {
    const result = checkGuard(
      fix([...VALID_FIX, M("internal/oracle-harness/src/tolerances.ts")])
    );
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain("tolerances.ts");
    expect(result.violations.join("\n")).toContain("calibration decision");
  });

  it("rejects editing the measurement code (harness src)", () => {
    const result = checkGuard(
      fix([...VALID_FIX, M("internal/oracle-harness/src/tier0.ts")])
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("tier0.ts is outside");
  });

  it("requires an added repro scene", () => {
    const noScene = VALID_FIX.filter((f) => !f.path.includes("oracle-scenes"));
    const result = checkGuard(fix(noScene));
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain("must add a repro scene");
  });

  it("does not count a modified (not added) scene as the required repro", () => {
    const modifiedScene = [
      M("packages/dom-to-figma/src/converter/nodes/frame/converter.ts"),
      M("packages/dom-to-figma/scripts/oracle-scenes/06-repro/skew.html"),
      A(".changeset/fix-skew.md"),
    ];
    const result = checkGuard(fix(modifiedScene));
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain("must add a repro scene");
  });

  it("rejects touching an unrelated app file", () => {
    const result = checkGuard(
      fix([...VALID_FIX, M("apps/playground/src/lib/converter.ts")])
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("apps/playground");
  });

  it("allows draining a resolved ledger class", () => {
    const result = checkGuard(
      fix([
        ...VALID_FIX,
        {
          path: "internal/oracle-harness/known-findings/geometry.x.md",
          status: "D",
        },
      ])
    );
    expect(result.ok).toBe(true);
  });

  it("blocks flipping a parked entry back to open", () => {
    const result = checkGuard({
      label: "oracle-fix",
      changedFiles: [...VALID_FIX],
      ledgerFlips: [{ class: "text.lineHeight", from: "parked", to: "open" }],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain("only a human may un-park");
  });

  it("allows an ordinary open→resolved transition", () => {
    const result = checkGuard({
      label: "oracle-fix",
      changedFiles: [...VALID_FIX],
      ledgerFlips: [{ class: "geometry.x", from: "open", to: "deleted" }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkGuard() — oracle-ledger", () => {
  it("passes a ledger-only note", () => {
    const result = checkGuard({
      label: "oracle-ledger",
      changedFiles: [
        M("internal/oracle-harness/known-findings/gradients.md"),
        M("internal/oracle-harness/known-findings/.run-counter"),
      ],
    });
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("rejects any code change in a ledger PR", () => {
    const result = checkGuard({
      label: "oracle-ledger",
      changedFiles: [
        M("internal/oracle-harness/known-findings/gradients.md"),
        M("packages/dom-to-figma/src/converter/nodes/frame/converter.ts"),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain(
      "outside the oracle-ledger allowlist"
    );
  });

  it("does not require a scene for a ledger PR", () => {
    const result = checkGuard({
      label: "oracle-ledger",
      changedFiles: [M("internal/oracle-harness/known-findings/gradients.md")],
    });
    expect(result.ok).toBe(true);
  });
});
