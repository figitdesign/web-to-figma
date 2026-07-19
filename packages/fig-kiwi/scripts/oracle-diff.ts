/**
 * Diff an oracle batch: what we sent to Figma (outbox copy pages) against
 * what Figma normalized it into (inbox captures). Part of the auto-layout
 * verification workflow.
 *
 * Usage:
 *   pnpm oracle:diff batch-01-flex
 *
 * The node-tree comparison lives in `../src/diff` (`diffFigmaTrees`) so it is
 * shared with the visual-parity harness; this script is just the batch I/O
 * wrapper around it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseClipboardHtml } from "../src/clipboard";
import { decodeFigmaData } from "../src/decoder";
import { diffFigmaTrees } from "../src/diff";
import type { OracleNode as Node } from "../src/tree";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

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

    const mismatches = diffFigmaTrees(sent, got);
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
