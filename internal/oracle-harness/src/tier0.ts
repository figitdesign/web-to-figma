import type { ConvertTrace } from "@figit/dom-to-figma";
import type { Finding } from "./findings";
import { severityFromDelta } from "./findings";
import type { GroundTruthElement } from "./ground-truth";
import { GEOMETRY_TOLERANCE_PX } from "./tolerances";

type Guid = { sessionID: number; localID: number };

/** A 2×3 affine transform as decoded from the payload. */
type Transform = {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
};

/** The subset of a decoded node change tier-0 reads. */
export type PayloadNode = {
  guid: Guid;
  parentIndex?: { guid: Guid; position: string };
  type?: string;
  size?: { x: number; y: number };
  transform?: Transform;
};

type Rect = { x: number; y: number; width: number; height: number };

export type Tier0Input = {
  sceneId: string;
  nodes: ReadonlyArray<PayloadNode>;
  trace: ConvertTrace;
  groundTruth: ReadonlyArray<GroundTruthElement>;
  /** Max per-axis deviation before a geometry finding; matches oracle-diff. */
  geometryTolerancePx?: number;
};

const TEXT_SUFFIX = /::text\[\d+]$/;
const IDENTITY: Transform = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
};

const GEOMETRY_AXES = [
  { field: "x", cls: "geometry.x" },
  { field: "y", cls: "geometry.y" },
  { field: "width", cls: "geometry.width" },
  { field: "height", cls: "geometry.height" },
] as const;

function guidKey(guid: Guid): string {
  return `${guid.sessionID}:${guid.localID}`;
}

/** Compose two affine transforms (parent ∘ child). */
function compose(a: Transform, b: Transform): Transform {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10,
    m01: a.m00 * b.m01 + a.m01 * b.m11,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10,
    m11: a.m10 * b.m01 + a.m11 * b.m11,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
  };
}

/** Node chain from the frame root down to `node` (root first), or null if the
 * chain doesn't reach the root. */
function pathFromRoot(
  node: PayloadNode,
  byKey: Map<string, PayloadNode>,
  rootKey: string
): Array<PayloadNode> | null {
  const chain: Array<PayloadNode> = [];
  const seen = new Set<string>();
  let current: PayloadNode | undefined = node;
  while (current) {
    const key = guidKey(current.guid);
    chain.push(current);
    if (key === rootKey) {
      chain.reverse();
      return chain;
    }
    if (seen.has(key)) {
      return null; // cycle
    }
    seen.add(key);
    const parentKey: string | undefined = current.parentIndex
      ? guidKey(current.parentIndex.guid)
      : undefined;
    current = parentKey ? byKey.get(parentKey) : undefined;
  }
  return null;
}

/** Reconstruct a node's absolute axis-aligned bounding box in scene coords
 * (frame root at origin). Handles rotation/skew by transforming the four
 * corners and taking their bounds — matching `getBoundingClientRect`. */
function absoluteRect(
  node: PayloadNode,
  byKey: Map<string, PayloadNode>,
  rootKey: string
): Rect | null {
  const chain = pathFromRoot(node, byKey, rootKey);
  if (!chain) {
    return null;
  }
  let abs = IDENTITY;
  for (const link of chain) {
    abs = compose(abs, link.transform ?? IDENTITY);
  }
  const size = node.size ?? { x: 0, y: 0 };
  const xs: Array<number> = [];
  const ys: Array<number> = [];
  for (const [lx, ly] of [
    [0, 0],
    [size.x, 0],
    [0, size.y],
    [size.x, size.y],
  ] as const) {
    xs.push(abs.m00 * lx + abs.m01 * ly + abs.m02);
    ys.push(abs.m10 * lx + abs.m11 * ly + abs.m12);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function pushGeometryFindings(
  out: Array<Finding>,
  sceneId: string,
  guid: string,
  domPath: string,
  expected: Rect,
  actual: Rect,
  tolerance: number
): void {
  for (const axis of GEOMETRY_AXES) {
    const want = expected[axis.field];
    const got = actual[axis.field];
    const delta = got - want;
    if (Math.abs(delta) > tolerance) {
      out.push({
        sceneId,
        tier: 0,
        class: axis.cls,
        severity: severityFromDelta(delta),
        guid,
        domPath,
        field: axis.field,
        expected: want,
        actual: got,
        deltaPx: Math.abs(delta),
      });
    }
  }
}

/**
 * Compare a scene's payload against its browser ground truth. Pure: no I/O.
 * Emits geometry.* findings per traced node, plus node.missing (a visible DOM
 * element with no node) and node.extra (a node whose DOM source is absent).
 */
export function diffTier0(input: Tier0Input): Array<Finding> {
  const tolerance = input.geometryTolerancePx ?? GEOMETRY_TOLERANCE_PX;
  const findings: Array<Finding> = [];

  const byKey = new Map<string, PayloadNode>();
  for (const node of input.nodes) {
    byKey.set(guidKey(node.guid), node);
  }
  const rootKey = guidKey(input.trace.rootGuid);
  const gtByPath = new Map(input.groundTruth.map((el) => [el.domPath, el]));
  const ownerPaths = new Set<string>();

  for (const entry of input.trace.entries) {
    const ownerPath = entry.domPath.replace(TEXT_SUFFIX, "");
    ownerPaths.add(ownerPath);

    const guid = guidKey(entry.guid);
    const node = byKey.get(guid);
    if (!node) {
      continue;
    }
    const rect = absoluteRect(node, byKey, rootKey);
    if (rect) {
      // `entry.rect` is the DOM rect the node was created from (element or
      // text run); compare the reconstructed node rect against it.
      pushGeometryFindings(
        findings,
        input.sceneId,
        guid,
        entry.domPath,
        entry.rect,
        rect,
        tolerance
      );
    }
    if (entry.kind !== "text" && !gtByPath.has(ownerPath)) {
      findings.push({
        sceneId: input.sceneId,
        tier: 0,
        class: "node.extra",
        severity: 1,
        guid,
        domPath: entry.domPath,
      });
    }
  }

  for (const el of input.groundTruth) {
    if (el.visible && !ownerPaths.has(el.domPath)) {
      findings.push({
        sceneId: input.sceneId,
        tier: 0,
        class: "node.missing",
        severity: 1,
        domPath: el.domPath,
      });
    }
  }

  return findings;
}
