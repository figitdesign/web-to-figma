/**
 * Structural diff between the payload we sent to Figma and the payload Figma
 * returns when the pasted, rendered frame is copied back. Both sides are
 * decoded kiwi node changes, so this reuses the same tree/stack knowledge as
 * the rest of the package.
 *
 * Figma omits fields at their default value when copying, so absent fields are
 * normalized to their defaults before comparing (see stack-fields).
 */
import { STACK_FIELD_DEFAULTS, TRACKED_STACK_FIELDS } from "./stack-fields";
import type { OracleNode } from "./tree";
import { treeOrder } from "./tree";

const NUMERIC_TOLERANCE = 0.11;
const GEOMETRY_TOLERANCE = 0.55;

export type Mismatch = {
  /** A positional node label (Figma re-ids nodes on paste, so there is no guid). */
  node: string;
  field: string;
  sent: unknown;
  got: unknown;
};

function normalized(node: OracleNode, field: string): unknown {
  return node[field] ?? STACK_FIELD_DEFAULTS[field];
}

function differs(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) > NUMERIC_TOLERANCE;
  }
  return a !== b;
}

/**
 * A grown (fill) or stretched child inside a stack is resized by Figma's layout
 * engine on paste, so its size legitimately differs from what we sent
 * pre-layout. Accept the got size when it equals the parent's inner size on
 * that axis.
 */
function growthExplainsSize(
  gotNode: OracleNode,
  gotByKey: ReadonlyMap<string, OracleNode>,
  axis: "x" | "y",
  gotValue: number
): boolean {
  const parentGuid = gotNode.parentIndex?.guid;
  const parent = parentGuid
    ? gotByKey.get(`${parentGuid.sessionID}:${parentGuid.localID}`)
    : undefined;
  const parentMode = parent?.stackMode;
  if (!parent || (parentMode !== "HORIZONTAL" && parentMode !== "VERTICAL")) {
    return false;
  }

  const axisIsParentPrimary = (axis === "x") === (parentMode === "HORIZONTAL");
  const grows =
    (gotNode.stackChildPrimaryGrow as number | undefined) === 1 &&
    axisIsParentPrimary;
  const stretches =
    gotNode.stackChildAlignSelf === "STRETCH" && !axisIsParentPrimary;
  if (!(grows || stretches)) {
    return false;
  }

  const parentSize = (parent.size as { x: number; y: number } | undefined)?.[
    axis
  ];
  if (parentSize === undefined) {
    return false;
  }
  const padLeading = (parent[
    axis === "x" ? "stackHorizontalPadding" : "stackVerticalPadding"
  ] ?? 0) as number;
  const padTrailing = (parent[
    axis === "x" ? "stackPaddingRight" : "stackPaddingBottom"
  ] ?? 0) as number;
  return (
    Math.abs(gotValue - (parentSize - padLeading - padTrailing)) <=
    GEOMETRY_TOLERANCE
  );
}

function diffNodeFields(
  sentNode: OracleNode,
  gotNode: OracleNode,
  label: string,
  out: Array<Mismatch>
): void {
  const fields = new Set([
    ...Object.keys(sentNode).filter((f) => TRACKED_STACK_FIELDS.has(f)),
    ...Object.keys(gotNode).filter((f) => TRACKED_STACK_FIELDS.has(f)),
  ]);
  for (const field of fields) {
    const sentValue = normalized(sentNode, field);
    const gotValue = normalized(gotNode, field);
    if (differs(sentValue, gotValue)) {
      out.push({ node: label, field, sent: sentValue, got: gotValue });
    }
  }
}

function diffNodeGeometry(
  sentNode: OracleNode,
  gotNode: OracleNode,
  index: number,
  gotByKey: ReadonlyMap<string, OracleNode>,
  label: string,
  out: Array<Mismatch>
): void {
  const sentSize = sentNode.size as { x: number; y: number } | undefined;
  const gotSize = gotNode.size as { x: number; y: number } | undefined;
  for (const axis of ["x", "y"] as const) {
    const a = sentSize?.[axis];
    const b = gotSize?.[axis];
    if (
      a !== undefined &&
      b !== undefined &&
      Math.abs(a - b) > GEOMETRY_TOLERANCE &&
      !growthExplainsSize(gotNode, gotByKey, axis, b)
    ) {
      out.push({ node: label, field: `size.${axis}`, sent: a, got: b });
    }
  }
  // Positions only below the pasted root (its transform is wherever the paste
  // landed on the canvas).
  if (index === 0) {
    return;
  }
  const sentT = sentNode.transform as { m02: number; m12: number } | undefined;
  const gotT = gotNode.transform as { m02: number; m12: number } | undefined;
  for (const [name, fieldKey] of [
    ["x", "m02"],
    ["y", "m12"],
  ] as const) {
    const a = sentT?.[fieldKey];
    const b = gotT?.[fieldKey];
    if (
      a !== undefined &&
      b !== undefined &&
      Math.abs(a - b) > GEOMETRY_TOLERANCE
    ) {
      out.push({ node: label, field: `pos.${name}`, sent: a, got: b });
    }
  }
}

function diffRoot(
  sentRoot: { name: string; nodes: Array<OracleNode> },
  gotRoot: { name: string; nodes: Array<OracleNode> }
): Array<Mismatch> {
  const mismatches: Array<Mismatch> = [];
  const sentTree = sentRoot.nodes;
  const gotTree = gotRoot.nodes;

  if (sentTree.length !== gotTree.length) {
    mismatches.push({
      node: `[${sentRoot.name}]`,
      field: "node count",
      sent: sentTree.length,
      got: gotTree.length,
    });
    return mismatches;
  }

  const gotByKey = new Map(
    gotTree.map((n) => [`${n.guid.sessionID}:${n.guid.localID}`, n])
  );

  sentTree.forEach((sentNode, i) => {
    const gotNode = gotTree[i] as OracleNode;
    const label = `[${sentRoot.name}] #${i} ${String(sentNode.name ?? sentNode.type)}`;
    diffNodeFields(sentNode, gotNode, label, mismatches);
    diffNodeGeometry(sentNode, gotNode, i, gotByKey, label, mismatches);
  });

  return mismatches;
}

/**
 * Compare a sent payload against a Figma copy-back payload. Top-level frames
 * pair by name; nodes within a frame pair by tree order. Returns the list of
 * structural mismatches (empty when Figma reproduced the payload exactly).
 */
export function diffFigmaTrees(
  sent: Array<OracleNode>,
  got: Array<OracleNode>
): Array<Mismatch> {
  const sentRoots = treeOrder(sent);
  const gotRoots = treeOrder(got);
  const mismatches: Array<Mismatch> = [];

  if (sentRoots.length !== gotRoots.length) {
    mismatches.push({
      node: "(payload)",
      field: "top-level frame count",
      sent: sentRoots.length,
      got: gotRoots.length,
    });
    return mismatches;
  }

  const gotByName = new Map(gotRoots.map((r) => [r.name, r]));
  for (const sentRoot of sentRoots) {
    const gotRoot = gotByName.get(sentRoot.name);
    if (gotRoot) {
      mismatches.push(...diffRoot(sentRoot, gotRoot));
    } else {
      mismatches.push({
        node: `[${sentRoot.name}]`,
        field: "frame",
        sent: "present",
        got: "missing (renamed?)",
      });
    }
  }
  return mismatches;
}
