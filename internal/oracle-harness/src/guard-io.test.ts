import { describe, expect, it } from "vitest";
import { parseNameStatus } from "./guard-io";

describe("parseNameStatus()", () => {
  it("parses adds, modifies and deletes", () => {
    const raw = [
      "A\tpackages/dom-to-figma/scripts/oracle-scenes/06/skew.html",
      "M\tpackages/dom-to-figma/src/converter/nodes/frame/converter.ts",
      "D\tinternal/oracle-harness/known-findings/geometry.x.md",
    ].join("\n");
    expect(parseNameStatus(raw)).toEqual([
      {
        path: "packages/dom-to-figma/scripts/oracle-scenes/06/skew.html",
        status: "A",
      },
      {
        path: "packages/dom-to-figma/src/converter/nodes/frame/converter.ts",
        status: "M",
      },
      {
        path: "internal/oracle-harness/known-findings/geometry.x.md",
        status: "D",
      },
    ]);
  });

  it("maps a rename to its destination path with status R", () => {
    const raw = "R100\told/scene.html\tnew/scene.html";
    expect(parseNameStatus(raw)).toEqual([
      { path: "new/scene.html", status: "R" },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseNameStatus("\n\nM\ta.ts\n\n")).toEqual([
      { path: "a.ts", status: "M" },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});
