/**
 * Diff an oracle batch: what we sent to Figma (outbox copy pages) against
 * what Figma normalized it into (inbox captures). Part of the auto-layout
 * verification workflow (see .context/auto-layout/PLAN.md).
 *
 * Usage:
 *   pnpm oracle:diff batch-01-flex
 *
 * For every scene present in both folders, the node trees are rebuilt from
 * parent links (Figma re-assigns guids and position strings on paste, so
 * nodes are paired by tree order), and layout-relevant fields are compared.
 * Figma omits fields at their default value when copying, so absent fields
 * are normalized before comparing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseClipboardHtml } from "../src/clipboard";
import { decodeFigmaData } from "../src/decoder";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

type Node = Record<string, unknown> & {
  guid: { sessionID: number; localID: number };
  parentIndex?: {
    guid: { sessionID: number; localID: number };
    position: string;
  };
  type?: string;
  name?: string;
};

/** Fields Figma drops when they hold the default value. */
const DEFAULTS: Record<string, unknown> = {
  stackMode: "NONE",
  stackSpacing: 0,
  stackCounterSpacing: 0,
  stackPrimaryAlignItems: "MIN",
  stackCounterAlignItems: "MIN",
  stackHorizontalPadding: 0,
  stackVerticalPadding: 0,
  stackPaddingRight: 0,
  stackPaddingBottom: 0,
  stackChildPrimaryGrow: 0,
  stackWrap: "NO_WRAP",
  stackPositioning: "AUTO",
  stackPrimarySizing: "FIXED",
  stackCounterSizing: "FIXED",
};

/** All stack-ish fields we track, defaults or not. */
const TRACKED = new Set([
  ...Object.keys(DEFAULTS),
  "stackChildAlignSelf",
  "stackPrimaryAlignContent",
  "stackCounterAlignContent",
]);

const NUMERIC_TOLERANCE = 0.11;
const GEOMETRY_TOLERANCE = 0.55;

function decodeEnvelope(html: string): Array<Node> {
  const decoded = decodeFigmaData(parseClipboardHtml(html).fig);
  return decoded.message.nodeChanges as Array<Node>;
}

function extractOutboxEnvelope(pageHtml: string): string {
  const match = /const ENVELOPE = (".*?");\n/s.exec(pageHtml);
  if (!match) {
    throw new Error("No embedded envelope found in outbox page");
  }
  return JSON.parse(match[1] as string) as string;
}

/**
 * Depth-first node list per canvas-level frame, children ordered by their
 * position strings (Figma's fractional indexing sorts lexicographically).
 * Multi-scene payloads have several canvas-level frames; DOCUMENT/CANVAS
 * nodes (including Figma's "Internal Only Canvas") never enter the walk.
 */
function treeOrder(
  changes: Array<Node>
): Array<{ name: string; nodes: Array<Node> }> {
  const key = (guid: { sessionID: number; localID: number }) =>
    `${guid.sessionID}:${guid.localID}`;
  const canvases = new Set(
    changes.filter((c) => c.type === "CANVAS").map((c) => key(c.guid))
  );
  const byParent = new Map<string, Array<Node>>();
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
  const out: Array<{ name: string; nodes: Array<Node> }> = [];
  for (const root of roots) {
    const nodes: Array<Node> = [];
    const visit = (node: Node) => {
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

function normalized(node: Node, field: string): unknown {
  return node[field] ?? DEFAULTS[field];
}

function differs(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) > NUMERIC_TOLERANCE;
  }
  return a !== b;
}

type Mismatch = { node: string; field: string; sent: unknown; got: unknown };

function diffScene(sent: Array<Node>, got: Array<Node>): Array<Mismatch> {
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

  // Multi-scene payloads: pair pasted frames with sent frames by name (Figma
  // preserves names; canvas order of a multi-selection copy is not reliable).
  const gotByName = new Map(gotRoots.map((r) => [r.name, r]));
  for (const sentRoot of sentRoots) {
    const gotRoot = gotByName.get(sentRoot.name);
    if (!gotRoot) {
      mismatches.push({
        node: `[${sentRoot.name}]`,
        field: "frame",
        sent: "present",
        got: "missing (renamed?)",
      });
      continue;
    }
    mismatches.push(...diffRoot(sentRoot, gotRoot));
  }
  return mismatches;
}

function diffRoot(
  sentRoot: { name: string; nodes: Array<Node> },
  gotRoot: { name: string; nodes: Array<Node> }
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

  sentTree.forEach((sentNode, i) => {
    const gotNode = gotTree[i] as Node;
    const label = `[${sentRoot.name}] #${i} ${String(sentNode.name ?? sentNode.type)}`;

    const fields = new Set([
      ...Object.keys(sentNode).filter((f) => TRACKED.has(f)),
      ...Object.keys(gotNode).filter((f) => TRACKED.has(f)),
    ]);
    for (const field of fields) {
      const sentValue = normalized(sentNode, field);
      const gotValue = normalized(gotNode, field);
      if (differs(sentValue, gotValue)) {
        mismatches.push({ node: label, field, sent: sentValue, got: gotValue });
      }
    }

    // Geometry: sizes everywhere; positions only below the pasted root (its
    // transform is wherever the paste landed on the canvas).
    const sentSize = sentNode.size as { x: number; y: number } | undefined;
    const gotSize = gotNode.size as { x: number; y: number } | undefined;
    for (const axis of ["x", "y"] as const) {
      const a = sentSize?.[axis];
      const b = gotSize?.[axis];
      if (
        a !== undefined &&
        b !== undefined &&
        Math.abs(a - b) > GEOMETRY_TOLERANCE
      ) {
        mismatches.push({
          node: label,
          field: `size.${axis}`,
          sent: a,
          got: b,
        });
      }
    }
    if (i > 0) {
      const sentT = sentNode.transform as
        | { m02: number; m12: number }
        | undefined;
      const gotT = gotNode.transform as
        | { m02: number; m12: number }
        | undefined;
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
          mismatches.push({
            node: label,
            field: `pos.${name}`,
            sent: a,
            got: b,
          });
        }
      }
    }
  });

  return mismatches;
}

function main() {
  const batch = process.argv[2];
  if (!batch) {
    console.error("Usage: pnpm oracle:diff <batch-name>");
    process.exit(1);
  }
  const outboxDir = resolve(REPO_ROOT, "oracle/outbox", batch);
  const inboxDir = resolve(REPO_ROOT, "oracle/inbox", batch);

  const scenes = readdirSync(outboxDir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();

  let failures = 0;
  for (const scene of scenes) {
    let sent: Array<Node>;
    let got: Array<Node>;
    try {
      sent = decodeEnvelope(
        extractOutboxEnvelope(
          readFileSync(resolve(outboxDir, `${scene}.html`), "utf-8")
        )
      );
      got = decodeEnvelope(
        readFileSync(resolve(inboxDir, `${scene}.html`), "utf-8")
      );
    } catch (error) {
      failures += 1;
      console.error(
        `✗ ${scene}: ${error instanceof Error ? error.message : error}`
      );
      continue;
    }

    const mismatches = diffScene(sent, got);
    if (mismatches.length === 0) {
      console.error(`✓ ${scene}`);
    } else {
      failures += 1;
      console.error(`✗ ${scene}:`);
      for (const m of mismatches) {
        console.error(
          `    ${m.node}  ${m.field}: sent ${JSON.stringify(m.sent)} → got ${JSON.stringify(m.got)}`
        );
      }
    }
  }

  console.error(`\n${scenes.length - failures}/${scenes.length} scenes clean`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
