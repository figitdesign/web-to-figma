/**
 * Regenerate `src/schema.json` from a Figma clipboard payload.
 *
 * Usage:
 *   pnpm extract-schema                  # read text/html from system clipboard
 *   pnpm extract-schema some/file.html   # read from a file
 *   pbpaste | pnpm extract-schema -      # read from stdin
 *
 * To produce a payload: open Figma, select any node, Cmd+C. The system
 * clipboard now holds the HTML envelope this script needs.
 *
 * Pipeline: HTML -> base64 figma payload -> raw kiwi bytes -> magic+version+
 * deflated schema segment -> kiwi-schema's `decodeBinarySchema` -> remap into
 * the schema shape this package's encoder consumes -> write JSON.
 */

import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { inflateSync } from "fflate";
import type {
  Definition as KiwiDefinition,
  Schema as KiwiSchema,
} from "kiwi-schema";
import { decodeBinarySchema } from "kiwi-schema";
import type { Field, Schema, TypeDef } from "../src/types";
import { readHtmlInput } from "./read-clipboard-html";

// Negative datatype sentinels for primitives, matching the encoder's switch.
const PRIMITIVES: Record<string, number> = {
  bool: -1,
  byte: -2,
  int: -3,
  uint: -4,
  float: -5,
  string: -6,
  int64: -7,
  uint64: -8,
};

const KIND_TO_NUMERIC: Record<KiwiDefinition["kind"], number> = {
  ENUM: 0,
  STRUCT: 1,
  MESSAGE: 2,
};

const HTML_FIGMA_START = "<!--(figma)";
const HTML_FIGMA_END = "(/figma)-->";
const FIG_PRELUDES = ["fig-kiwi", "fig-jam.", "fig-deck"];

function extractFigPayload(html: string): Uint8Array {
  // The markers live inside an HTML attribute (`data-buffer="<!--(figma)…"`).
  // Most HTML serializers — including macOS NSPasteboard's normalization and
  // Chromium's `navigator.clipboard.write` path — entity-encode `<` and `>`
  // inside attribute values, even though it isn't strictly required. So both
  // raw and entity-encoded forms show up in the wild; normalize before search.
  const normalized = html
    .replaceAll("&lt;!--(figmeta)", "<!--(figmeta)")
    .replaceAll("(/figmeta)--&gt;", "(/figmeta)-->")
    .replaceAll("&lt;!--(figma)", HTML_FIGMA_START)
    .replaceAll("(/figma)--&gt;", HTML_FIGMA_END);

  const start = normalized.indexOf(HTML_FIGMA_START);
  const end = normalized.indexOf(HTML_FIGMA_END);
  if (start === -1 || end === -1 || start > end) {
    const SAMPLE_LIMIT = 240;
    const sample =
      html.length > SAMPLE_LIMIT
        ? `${html.slice(0, SAMPLE_LIMIT)}… (truncated, ${html.length} bytes total)`
        : html || "(empty)";
    throw new Error(
      `Couldn't find Figma payload markers in clipboard HTML.\n` +
        "Make sure you copied a node from Figma (markers <!--(figma)…(/figma)--> expected).\n\n" +
        `Received:\n${sample}`
    );
  }
  const base64 = normalized.slice(start + HTML_FIGMA_START.length, end);
  return new Uint8Array(Buffer.from(base64, "base64"));
}

type FigHeader = { prelude: string; version: number; schema: Uint8Array };

function parseFigHeader(bytes: Uint8Array): FigHeader {
  const prelude = new TextDecoder().decode(bytes.slice(0, 8));
  if (!FIG_PRELUDES.includes(prelude)) {
    throw new Error(
      `Unexpected fig prelude "${prelude}" — expected one of ${FIG_PRELUDES.join(", ")}.`
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  const schemaLen = view.getUint32(12, true);
  const schemaBytes = bytes.slice(16, 16 + schemaLen);
  return { prelude, version, schema: inflateSync(schemaBytes) };
}

function resolveDatatype(
  type: string | null,
  ownDef: KiwiDefinition,
  defs: ReadonlyArray<KiwiDefinition>
): { datatype: number; datatype_name: string } {
  // Enum fields have no underlying type — by convention this package marks them
  // with the enum's own type index, so encoder lookups remain symmetric.
  if (type === null) {
    const idx = defs.findIndex((d) => d.name === ownDef.name);
    return { datatype: idx, datatype_name: ownDef.name };
  }
  const primitive = PRIMITIVES[type];
  if (primitive !== undefined) {
    return { datatype: primitive, datatype_name: type };
  }
  const idx = defs.findIndex((d) => d.name === type);
  if (idx === -1) {
    throw new Error(
      `Unknown type "${type}" referenced by field of "${ownDef.name}"`
    );
  }
  return { datatype: idx, datatype_name: type };
}

function toLocalSchema(version: number, kiwi: KiwiSchema): Schema {
  const types: Array<TypeDef> = kiwi.definitions.map((def, index) => {
    const fields: Record<string, Field> = {};
    for (const f of def.fields) {
      const { datatype, datatype_name } = resolveDatatype(
        f.type,
        def,
        kiwi.definitions
      );
      fields[String(f.value)] = {
        name: f.name,
        datatype,
        array: f.isArray,
        datatype_name,
      };
    }
    return {
      index,
      name: def.name,
      kind: KIND_TO_NUMERIC[def.kind],
      kind_name: def.kind.toLowerCase(),
      fields,
      field_count: def.fields.length,
    };
  });
  return { version, types, type_count: types.length };
}

function main() {
  const html = readHtmlInput(process.argv[2]);
  const fig = extractFigPayload(html);
  const { prelude, version, schema: schemaBytes } = parseFigHeader(fig);
  const kiwi = decodeBinarySchema(schemaBytes);
  const local = toLocalSchema(version, kiwi);

  const outPath = resolve(import.meta.dirname, "../src/schema.json");
  writeFileSync(outPath, `${JSON.stringify(local, null, 2)}\n`);

  console.error(`prelude:  ${prelude}`);
  console.error(`version:  ${version}`);
  console.error(`types:    ${local.types.length}`);
  console.error(`written:  ${outPath}`);
}

main();
