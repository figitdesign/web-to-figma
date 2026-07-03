/**
 * Save the Figma clipboard payload currently on the system clipboard into the
 * oracle inbox, for the human-in-the-loop auto-layout verification workflow
 * (see .context/auto-layout/PLAN.md).
 *
 * Usage (after copying a node in Figma with Cmd+C):
 *   pnpm oracle:capture batch-00-smoke/01-two-boxes
 *   pnpm oracle:capture batch-00-smoke/01-two-boxes some/file.html   # or pipe HTML on stdin
 *
 * Writes:
 *   oracle/inbox/batch-00-smoke/01-two-boxes.html   raw clipboard envelope
 *   oracle/inbox/batch-00-smoke/01-two-boxes.json   decoded message (blobs summarized)
 *
 * The payload is decoded before anything is written, so a wrong copy (empty
 * clipboard, non-Figma content) fails loudly instead of polluting the inbox.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, normalize, resolve, sep } from "node:path";
import process from "node:process";
import { parseClipboardHtml } from "../src/clipboard";
import { decodeFigmaData } from "../src/decoder";
import { readHtmlInput } from "./read-clipboard-html";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const INBOX = resolve(REPO_ROOT, "oracle/inbox");

// Render binary blobs as a size summary: the raw .html file next to the JSON
// keeps the exact bytes, the JSON exists for eyeballing and diffing.
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `<${value.length} bytes>`;
  }
  return value;
}

function main() {
  const name = process.argv[2];
  if (!name) {
    console.error(
      "Usage: pnpm oracle:capture <batch>/<scene>   (e.g. batch-00-smoke/01-two-boxes)"
    );
    process.exit(1);
  }
  const htmlPath = resolve(INBOX, `${normalize(name)}.html`);
  if (!htmlPath.startsWith(INBOX + sep)) {
    console.error(`Capture name escapes the inbox: ${name}`);
    process.exit(1);
  }

  const html = readHtmlInput(process.argv[3]);
  const { fig, meta } = parseClipboardHtml(html);
  const decoded = decodeFigmaData(fig);

  const nodeChanges = decoded.message.nodeChanges;
  const nodeCount = Array.isArray(nodeChanges) ? nodeChanges.length : 0;

  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  writeFileSync(
    htmlPath.replace(/\.html$/, ".json"),
    `${JSON.stringify(
      {
        meta,
        prelude: decoded.prelude,
        version: decoded.version,
        message: decoded.message,
      },
      jsonReplacer,
      2
    )}\n`
  );

  console.error(`prelude:      ${decoded.prelude}`);
  console.error(`version:      ${decoded.version}`);
  console.error(`nodeChanges:  ${nodeCount}`);
  console.error(`fileKey:      ${meta?.fileKey ?? "(none)"}`);
  console.error(`written:      ${htmlPath}`);
  console.error(`              ${htmlPath.replace(/\.html$/, ".json")}`);
}

main();
