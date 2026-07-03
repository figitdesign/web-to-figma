/**
 * Distill a clean oracle batch into a committed regression fixture: for each
 * scene, the Figma-normalized node tree (names, sizes, positions, non-default
 * stack fields) as vetted by a real paste round-trip. The fixture is consumed
 * by `figma.oracle.browser.test.ts` in dom-to-figma, which re-checks the
 * converter's output against it in CI — no Figma needed.
 *
 * Run only after `pnpm oracle:diff <batch>` reports the batch clean:
 *   pnpm oracle:distill batch-01-flex
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseClipboardHtml } from "../src/clipboard";
import { decodeFigmaData } from "../src/decoder";
import type { OracleNode } from "./oracle-shared";
import {
  STACK_DEFAULTS,
  TRACKED_STACK_FIELDS,
  treeOrder,
} from "./oracle-shared";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE_DIR = resolve(
  REPO_ROOT,
  "packages/dom-to-figma/src/__fixtures__/oracle"
);

type FixtureNode = {
  name: string;
  size: { x: number; y: number } | null;
  /** Relative to the parent; null for the scene root (canvas position). */
  pos: { x: number; y: number } | null;
  /** Non-default tracked stack fields, as normalized by Figma. */
  stack: Record<string, unknown>;
  /** Whether the parent is an auto-layout stack. Child fill/stretch fields
   * are inert (and harness-geometry-dependent) when it isn't, so consumers
   * skip them in comparisons. */
  parentIsStack: boolean;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFixtureNode(
  node: OracleNode,
  isRoot: boolean,
  parentIsStack: boolean
): FixtureNode {
  const stack: Record<string, unknown> = {};
  for (const field of TRACKED_STACK_FIELDS) {
    const value = node[field];
    if (value !== undefined && value !== STACK_DEFAULTS[field]) {
      stack[field] = typeof value === "number" ? round2(value) : value;
    }
  }
  const size = node.size as { x: number; y: number } | undefined;
  const transform = node.transform as { m02: number; m12: number } | undefined;
  return {
    name: String(node.name ?? node.type),
    size: size ? { x: round2(size.x), y: round2(size.y) } : null,
    pos:
      isRoot || !transform
        ? null
        : { x: round2(transform.m02), y: round2(transform.m12) },
    stack,
    parentIsStack,
  };
}

function main() {
  const batch = process.argv[2];
  if (!batch) {
    console.error("Usage: pnpm oracle:distill <batch-name>");
    process.exit(1);
  }

  const captureFile = resolve(
    REPO_ROOT,
    "oracle/inbox",
    batch,
    "all-scenes.html"
  );
  const decoded = decodeFigmaData(
    parseClipboardHtml(readFileSync(captureFile, "utf-8")).fig
  );
  const roots = treeOrder(decoded.message.nodeChanges as Array<OracleNode>);

  const byKey = new Map(
    (decoded.message.nodeChanges as Array<OracleNode>).map((n) => [
      `${n.guid.sessionID}:${n.guid.localID}`,
      n,
    ])
  );
  const parentIsStack = (node: OracleNode): boolean => {
    const guid = node.parentIndex?.guid;
    const parent = guid ? byKey.get(`${guid.sessionID}:${guid.localID}`) : null;
    return (
      parent?.stackMode === "HORIZONTAL" || parent?.stackMode === "VERTICAL"
    );
  };

  const scenes = roots.map((root) => {
    const rootSize = root.nodes[0]?.size as { x: number; y: number };
    return {
      name: root.name,
      width: rootSize.x,
      height: rootSize.y,
      nodes: root.nodes.map((node, i) =>
        toFixtureNode(node, i === 0, parentIsStack(node))
      ),
    };
  });

  const outPath = resolve(FIXTURE_DIR, `${batch}.json`);
  writeFileSync(
    outPath,
    `${JSON.stringify({ batch, source: "figma paste round-trip", scenes }, null, 2)}\n`
  );
  console.error(`${scenes.length} scenes distilled -> ${outPath}`);
}

main();
