import { describe, expect, it } from "vitest";
import { diffFigmaTrees } from "./diff";
import type { OracleNode } from "./tree";

function g(localID: number) {
  return { sessionID: 0, localID };
}

/** DOCUMENT → CANVAS → FRAME "F" → FRAME "box". `frame`/`box` override fields. */
function tree(
  frame: Record<string, unknown> = {},
  box: Record<string, unknown> = {}
): Array<OracleNode> {
  return [
    { guid: g(0), type: "DOCUMENT" },
    { guid: g(1), type: "CANVAS", parentIndex: { guid: g(0), position: "a" } },
    {
      guid: g(2),
      type: "FRAME",
      name: "F",
      size: { x: 320, y: 200 },
      parentIndex: { guid: g(1), position: "a" },
      ...frame,
    },
    {
      guid: g(3),
      type: "FRAME",
      name: "box",
      size: { x: 100, y: 80 },
      transform: { m02: 10, m12: 10 },
      parentIndex: { guid: g(2), position: "a" },
      ...box,
    },
  ] as Array<OracleNode>;
}

describe("diffFigmaTrees()", () => {
  it("reports nothing for identical trees", () => {
    expect(diffFigmaTrees(tree(), tree())).toEqual([]);
  });

  it("normalizes an absent field to its default", () => {
    // sent omits stackSpacing (default 0); got sets it to 0 → no mismatch.
    expect(diffFigmaTrees(tree(), tree({ stackSpacing: 0 }))).toEqual([]);
  });

  it("flags a changed stack field", () => {
    const findings = diffFigmaTrees(tree(), tree({ stackSpacing: 8 }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      field: "stackSpacing",
      sent: 0,
      got: 8,
    });
  });

  it("flags a child size change beyond tolerance", () => {
    const findings = diffFigmaTrees(
      tree(),
      tree({}, { size: { x: 130, y: 80 } })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ field: "size.x", sent: 100, got: 130 });
  });

  it("flags a renamed top-level frame as missing", () => {
    const findings = diffFigmaTrees(tree(), tree({ name: "Renamed" }));
    expect(findings.some((m) => m.field === "frame")).toBe(true);
  });

  it("flags a node-count mismatch", () => {
    const fewer = tree().slice(0, 3); // drop the box
    const findings = diffFigmaTrees(tree(), fewer);
    expect(findings[0]).toMatchObject({ field: "node count" });
  });
});
