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
import type { OracleNode as Node } from "./oracle-shared";
import {
  STACK_DEFAULTS as DEFAULTS,
  TRACKED_STACK_FIELDS as TRACKED,
  treeOrder,
} from "./oracle-shared";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

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

  const gotByKey = new Map(
    gotTree.map((n) => [`${n.guid.sessionID}:${n.guid.localID}`, n])
  );

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
        Math.abs(a - b) > GEOMETRY_TOLERANCE &&
        !growthExplainsSize(gotNode, gotByKey, axis, b)
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

/**
 * A grown (fill) or stretched child inside a stack is resized by Figma's
 * layout engine on paste, so its size legitimately differs from what we sent
 * pre-layout. Accept the got size when it equals the parent's inner size on
 * that axis (the only value Figma's engine can produce for grow/stretch with
 * a single grown child; multi-fill splits are verified by the sent side
 * matching in the first place).
 */
function growthExplainsSize(
  gotNode: Node,
  gotByKey: ReadonlyMap<string, Node>,
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
