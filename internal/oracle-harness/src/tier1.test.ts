import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mismatch } from "@figit/fig-kiwi";
import { describe, expect, it } from "vitest";
import { diffTier1, mismatchesToFindings } from "./tier1";

const FIXTURES = resolve(import.meta.dirname, "figma/__fixtures__");
const SENT = readFileSync(resolve(FIXTURES, "two-boxes.sent.html"), "utf-8");
const CAPTURED = readFileSync(
  resolve(FIXTURES, "two-boxes.captured.html"),
  "utf-8"
);

describe("diffTier1() on a real copy-back pair", () => {
  it("finds nothing when Figma reproduced the payload", () => {
    // Figma renders 00-smoke/two-boxes identically to what we sent.
    expect(diffTier1("00-smoke/two-boxes", SENT, CAPTURED)).toEqual([]);
  });
});

describe("mismatchesToFindings()", () => {
  it("maps a geometry mismatch to a delta-scaled kiwi finding", () => {
    const m: Mismatch = {
      node: "[F] #1 box",
      field: "size.x",
      sent: 100,
      got: 104,
    };
    const [finding] = mismatchesToFindings("s", [m]);
    expect(finding).toMatchObject({
      tier: 1,
      class: "kiwi.size.x",
      field: "size.x",
      expected: 100,
      actual: 104,
      deltaPx: 4,
      severity: 0.5,
      domPath: "[F] #1 box",
    });
  });

  it("maps a categorical mismatch to a fixed severity, no delta", () => {
    const m: Mismatch = {
      node: "[F] #0 F",
      field: "stackSpacing",
      sent: 0,
      got: 8,
    };
    const [finding] = mismatchesToFindings("s", [m]);
    expect(finding).toMatchObject({
      class: "kiwi.stackSpacing",
      severity: 0.5,
    });
    expect(finding?.deltaPx).toBeUndefined();
  });

  it("path-sanitizes field names into the class", () => {
    const m: Mismatch = {
      node: "(payload)",
      field: "node count",
      sent: 4,
      got: 3,
    };
    expect(mismatchesToFindings("s", [m])[0]?.class).toBe("kiwi.node-count");
  });
});
