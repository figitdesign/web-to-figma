/** Shared helpers for the oracle diff/distill scripts. */

export {
  STACK_FIELD_DEFAULTS as STACK_DEFAULTS,
  TRACKED_STACK_FIELDS,
} from "../src/stack-fields";

export type OracleNode = Record<string, unknown> & {
  guid: { sessionID: number; localID: number };
  parentIndex?: {
    guid: { sessionID: number; localID: number };
    position: string;
  };
  type?: string;
  name?: string;
};

/**
 * Depth-first node list per canvas-level frame, children ordered by their
 * position strings (Figma's fractional indexing sorts lexicographically).
 * Multi-scene payloads have several canvas-level frames; DOCUMENT/CANVAS
 * nodes (including Figma's "Internal Only Canvas") never enter the walk.
 */
export function treeOrder(
  changes: Array<OracleNode>
): Array<{ name: string; nodes: Array<OracleNode> }> {
  const key = (guid: { sessionID: number; localID: number }) =>
    `${guid.sessionID}:${guid.localID}`;
  const canvases = new Set(
    changes.filter((c) => c.type === "CANVAS").map((c) => key(c.guid))
  );
  const byParent = new Map<string, Array<OracleNode>>();
  for (const change of changes) {
    if (
      !change.parentIndex ||
      change.type === "DOCUMENT" ||
      change.type === "CANVAS"
    ) {
      continue;
    }
    const parent = key(change.parentIndex.guid);
    const bucket = byParent.get(parent) ?? [];
    bucket.push(change);
    byParent.set(parent, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) =>
      (a.parentIndex?.position ?? "").localeCompare(
        b.parentIndex?.position ?? ""
      )
    );
  }

  const roots = [...canvases].flatMap((c) => byParent.get(c) ?? []);
  const out: Array<{ name: string; nodes: Array<OracleNode> }> = [];
  for (const root of roots) {
    const nodes: Array<OracleNode> = [];
    const visit = (node: OracleNode) => {
      nodes.push(node);
      for (const child of byParent.get(key(node.guid)) ?? []) {
        visit(child);
      }
    };
    visit(root);
    out.push({ name: String(root.name ?? "?"), nodes });
  }
  return out;
}
