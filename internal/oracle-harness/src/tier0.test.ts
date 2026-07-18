import type { ConvertTrace } from "@figit/dom-to-figma";
import { describe, expect, it } from "vitest";
import type { GroundTruthElement } from "./ground-truth";
import type { PayloadNode } from "./tier0";
import { diffTier0 } from "./tier0";

const ROOT_LOCAL = 2;

function guid(localID: number) {
  return { sessionID: 0, localID };
}

/** A node positioned at (x, y) relative to its parent, sized w×h. */
function node(
  localID: number,
  parentLocal: number,
  x: number,
  y: number,
  w: number,
  h: number
): PayloadNode {
  return {
    guid: guid(localID),
    parentIndex: { guid: guid(parentLocal), position: "0" },
    type: "FRAME",
    size: { x: w, y: h },
    transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y },
  };
}

function rootNode(): PayloadNode {
  return {
    guid: guid(ROOT_LOCAL),
    type: "FRAME",
    size: { x: 320, y: 200 },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
  };
}

function el(
  domPath: string,
  rect: { x: number; y: number; width: number; height: number },
  visible = true
): GroundTruthElement {
  return { domPath, rect, styles: {}, visible };
}

type TraceEntry = ConvertTrace["entries"][number];

function entry(
  localID: number,
  domPath: string,
  rect: { x: number; y: number; width: number; height: number },
  kind: TraceEntry["kind"] = "frame"
): TraceEntry {
  return { guid: guid(localID), kind, tag: "div", domPath, rect };
}

const BOX_RECT = { x: 40, y: 30, width: 100, height: 80 };

/** Root(2) → body(3 @0,0 320×200) → box(4 @40,30 100×80). */
function baseScene() {
  const nodes: Array<PayloadNode> = [
    rootNode(),
    node(3, ROOT_LOCAL, 0, 0, 320, 200),
    node(4, 3, 40, 30, 100, 80),
  ];
  const trace: ConvertTrace = {
    rootGuid: guid(ROOT_LOCAL),
    entries: [
      entry(3, ":scope", { x: 0, y: 0, width: 320, height: 200 }),
      entry(4, ":scope > div:nth-child(1)", BOX_RECT),
    ],
  };
  const groundTruth: Array<GroundTruthElement> = [
    el(":scope", { x: 0, y: 0, width: 320, height: 200 }),
    el(":scope > div:nth-child(1)", BOX_RECT),
  ];
  return { nodes, trace, groundTruth };
}

describe("diffTier0()", () => {
  it("reports nothing when payload matches ground truth", () => {
    const { nodes, trace, groundTruth } = baseScene();
    expect(diffTier0({ sceneId: "s", nodes, trace, groundTruth })).toHaveLength(
      0
    );
  });

  it("flags a shifted x with the delta and scaled severity", () => {
    const { nodes, trace, groundTruth } = baseScene();
    // Move the box node 2px right of where it was measured.
    nodes[2] = node(4, 3, 42, 30, 100, 80);
    const findings = diffTier0({ sceneId: "s", nodes, trace, groundTruth });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "geometry.x",
      field: "x",
      expected: 40,
      actual: 42,
      deltaPx: 2,
      severity: 0.25,
      domPath: ":scope > div:nth-child(1)",
      guid: "0:4",
    });
  });

  it("respects the geometry tolerance boundary", () => {
    const under = baseScene();
    under.nodes[2] = node(4, 3, 40.5, 30, 100, 80);
    expect(diffTier0({ sceneId: "s", ...under })).toHaveLength(0);

    const over = baseScene();
    over.nodes[2] = node(4, 3, 40.6, 30, 100, 80);
    expect(diffTier0({ sceneId: "s", ...over })).toHaveLength(1);
  });

  it("reconstructs absolute rects through nested transforms", () => {
    // Root → body → container(@10,10) → box(@20,15); box absolute = (30,25).
    const nodes: Array<PayloadNode> = [
      rootNode(),
      node(3, ROOT_LOCAL, 0, 0, 320, 200),
      node(4, 3, 10, 10, 200, 150),
      node(5, 4, 20, 15, 100, 80),
    ];
    const boxAbs = { x: 30, y: 25, width: 100, height: 80 };
    const trace: ConvertTrace = {
      rootGuid: guid(ROOT_LOCAL),
      entries: [
        entry(3, ":scope", { x: 0, y: 0, width: 320, height: 200 }),
        entry(4, ":scope > div:nth-child(1)", {
          x: 10,
          y: 10,
          width: 200,
          height: 150,
        }),
        entry(5, ":scope > div:nth-child(1) > div:nth-child(1)", boxAbs),
      ],
    };
    const groundTruth = [
      el(":scope", { x: 0, y: 0, width: 320, height: 200 }),
      el(":scope > div:nth-child(1)", {
        x: 10,
        y: 10,
        width: 200,
        height: 150,
      }),
      el(":scope > div:nth-child(1) > div:nth-child(1)", boxAbs),
    ];
    expect(diffTier0({ sceneId: "s", nodes, trace, groundTruth })).toHaveLength(
      0
    );
  });

  it("flags a visible ground-truth element with no traced node", () => {
    const { nodes, trace, groundTruth } = baseScene();
    groundTruth.push(
      el(":scope > div:nth-child(2)", { x: 200, y: 30, width: 50, height: 50 })
    );
    const findings = diffTier0({ sceneId: "s", nodes, trace, groundTruth });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "node.missing",
      domPath: ":scope > div:nth-child(2)",
    });
  });

  it("does not flag an invisible unmatched element as missing", () => {
    const { nodes, trace, groundTruth } = baseScene();
    groundTruth.push(
      el(
        ":scope > style:nth-child(2)",
        { x: 0, y: 0, width: 0, height: 0 },
        false
      )
    );
    expect(diffTier0({ sceneId: "s", nodes, trace, groundTruth })).toHaveLength(
      0
    );
  });

  it("flags a node whose DOM source is absent as extra", () => {
    const { nodes, trace, groundTruth } = baseScene();
    trace.entries.push(
      entry(9, ":scope > div:nth-child(9)", {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      })
    );
    nodes.push(node(9, 3, 0, 0, 10, 10));
    const findings = diffTier0({ sceneId: "s", nodes, trace, groundTruth });
    expect(findings.some((f) => f.class === "node.extra")).toBe(true);
  });

  it("treats text runs (shared owner path) as neither missing nor extra", () => {
    const { nodes, trace, groundTruth } = baseScene();
    // A text run whose owner is the existing box element.
    trace.entries.push(
      entry(7, ":scope > div:nth-child(1)::text[0]", BOX_RECT, "text")
    );
    nodes.push(node(7, 3, 40, 30, 100, 80));
    const findings = diffTier0({ sceneId: "s", nodes, trace, groundTruth });
    expect(findings).toHaveLength(0);
  });

  it("produces order-stable output for identical inputs", () => {
    const a = diffTier0({ sceneId: "s", ...baseScene() });
    const b = diffTier0({ sceneId: "s", ...baseScene() });
    expect(a).toStrictEqual(b);
  });
});
