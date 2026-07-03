import { inflateSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import { KiwiReader } from "./kiwi-reader";
import type { Field, Schema, TypeDef } from "./types";

// Kiwi datatype sentinels (negative = primitive, non-negative = type index).
const PRIM = {
  BOOL: -1,
  BYTE: -2,
  INT: -3,
  UINT: -4,
  FLOAT: -5,
  STRING: -6,
  INT64: -7,
  UINT64: -8,
} as const;

// `TypeDef.kind` values.
const ENUM = 0;
const STRUCT = 1;
const MESSAGE = 2;

const KIND_NAMES: Record<number, string> = {
  [ENUM]: "enum",
  [STRUCT]: "struct",
  [MESSAGE]: "message",
};

const PRIMITIVE_NAMES: Record<number, string> = {
  [PRIM.BOOL]: "bool",
  [PRIM.BYTE]: "byte",
  [PRIM.INT]: "int",
  [PRIM.UINT]: "uint",
  [PRIM.FLOAT]: "float",
  [PRIM.STRING]: "string",
  [PRIM.INT64]: "int64",
  [PRIM.UINT64]: "uint64",
};

// Copies made in Figma Design, FigJam, and Slides differ only in prelude.
const FIG_PRELUDES = ["fig-kiwi", "fig-jam.", "fig-deck"];
const ROOT_TYPE_NAME = "Message";

function decodePrimitive(r: KiwiReader, datatype: number): unknown {
  switch (datatype) {
    case PRIM.BOOL:
      return r.bool();
    case PRIM.BYTE:
      return r.byte();
    case PRIM.INT:
      return r.int();
    case PRIM.UINT:
      return r.uint();
    case PRIM.FLOAT:
      return r.float();
    case PRIM.STRING:
      return r.string();
    case PRIM.INT64:
      return r.int64();
    case PRIM.UINT64:
      return r.uint64();
    default:
      throw new Error(`Unknown primitive datatype: ${datatype}`);
  }
}

function decodeArray(
  r: KiwiReader,
  types: ReadonlyArray<TypeDef>,
  datatype: number
): unknown {
  const length = r.uint();
  // Byte arrays are a length-prefixed raw block, matching the encoder.
  if (datatype === PRIM.BYTE) {
    return r.rawBytes(length);
  }
  const out: Array<unknown> = [];
  for (let i = 0; i < length; i += 1) {
    out.push(decodeType(r, types, datatype, false));
  }
  return out;
}

function decodeEnum(r: KiwiReader, type: TypeDef): unknown {
  const id = r.uint();
  const field = type.fields[String(id)];
  // Unknown values can appear when Figma's schema is newer than the payload's
  // consumers expect; surface the raw id rather than failing the whole decode.
  return field ? field.name : id;
}

function decodeStruct(
  r: KiwiReader,
  types: ReadonlyArray<TypeDef>,
  type: TypeDef
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Structs serialize every field in id order, no terminator.
  const fieldCount = Object.keys(type.fields).length;
  for (let id = 1; id <= fieldCount; id += 1) {
    const field = type.fields[String(id)];
    if (!field) {
      throw new Error(`Field ${id} missing in struct '${type.name}'`);
    }
    out[field.name] = decodeType(r, types, field.datatype, field.array);
  }
  return out;
}

function decodeMessage(
  r: KiwiReader,
  types: ReadonlyArray<TypeDef>,
  type: TypeDef
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Messages emit only present fields (each preceded by its id), terminated by 0.
  for (;;) {
    const fieldId = r.uint();
    if (fieldId === 0) {
      return out;
    }
    const field = type.fields[String(fieldId)];
    if (!field) {
      // Kiwi data is not self-delimiting, so an unknown field id is fatal.
      // Decoding always uses the schema embedded in the same payload, which
      // makes this unreachable for well-formed input.
      throw new Error(
        `Unknown field id ${fieldId} in message '${type.name}' — payload and schema disagree`
      );
    }
    out[field.name] = decodeType(r, types, field.datatype, field.array);
  }
}

function decodeType(
  r: KiwiReader,
  types: ReadonlyArray<TypeDef>,
  datatype: number,
  isArray: boolean
): unknown {
  if (isArray) {
    return decodeArray(r, types, datatype);
  }
  if (datatype < 0) {
    return decodePrimitive(r, datatype);
  }

  const type = types[datatype];
  if (!type) {
    throw new Error(`Type definition not found for datatype ${datatype}`);
  }
  switch (type.kind) {
    case ENUM:
      return decodeEnum(r, type);
    case STRUCT:
      return decodeStruct(r, types, type);
    case MESSAGE:
      return decodeMessage(r, types, type);
    default:
      throw new Error(`Unknown kind ${type.kind} for type '${type.name}'`);
  }
}

/** Parse the binary Kiwi schema segment; mirrors the encoder's `writeSchema`. */
function readSchema(bytes: Uint8Array, version: number): Schema {
  const r = new KiwiReader(bytes);
  const typeCount = r.uint();

  type RawField = Field & { id: number };
  const raw: Array<{
    name: string;
    kind: number;
    fields: Array<RawField>;
  }> = [];

  for (let i = 0; i < typeCount; i += 1) {
    const name = r.string();
    const kind = r.byte();
    const fieldCount = r.uint();
    const fields: Array<RawField> = [];
    for (let f = 0; f < fieldCount; f += 1) {
      const fieldName = r.string();
      const datatype = r.int();
      const array = r.bool();
      const id = r.uint();
      fields.push({ name: fieldName, datatype, array, datatype_name: "", id });
    }
    raw.push({ name, kind, fields });
  }

  const datatypeName = (datatype: number): string =>
    PRIMITIVE_NAMES[datatype] ?? raw[datatype]?.name ?? `unknown(${datatype})`;

  const types: Array<TypeDef> = raw.map((t, index) => {
    const fields: Record<string, Field> = {};
    for (const f of t.fields) {
      fields[String(f.id)] = {
        name: f.name,
        datatype: f.datatype,
        array: f.array,
        datatype_name: datatypeName(f.datatype),
      };
    }
    return {
      index,
      name: t.name,
      kind: t.kind,
      kind_name: KIND_NAMES[t.kind] ?? `unknown(${t.kind})`,
      fields,
      field_count: t.fields.length,
    };
  });

  return { version, types, type_count: types.length };
}

// Figma sniffs chunk compression on paste rather than fixing it per format
// version, and (as of 2026) writes deflate for the schema chunk but zstd for
// the data chunk. Mirror the sniffing: zstd by magic number, deflate otherwise.
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;

function decompressChunk(chunk: Uint8Array): Uint8Array {
  const isZstd = ZSTD_MAGIC.every((byte, i) => chunk[i] === byte);
  return isZstd ? zstdDecompress(chunk) : inflateSync(chunk);
}

export type DecodedFigmaData = {
  prelude: string;
  version: number;
  schema: Schema;
  /** The decoded root `Message` (e.g. `{ type: "NODE_CHANGES", nodeChanges: [...] }`). */
  message: Record<string, unknown>;
};

/**
 * Decode a fig-kiwi binary envelope (magic + version + compressed schema +
 * compressed data, deflate or zstd per chunk) into the root Kiwi `Message`,
 * using the schema embedded in the payload itself so newer Figma schema
 * versions decode without a regenerated `schema.json`.
 */
export function decodeFigmaData(figBytes: Uint8Array): DecodedFigmaData {
  const prelude = new TextDecoder().decode(figBytes.subarray(0, 8));
  if (!FIG_PRELUDES.includes(prelude)) {
    throw new Error(
      `Unexpected fig prelude "${prelude}" — expected one of ${FIG_PRELUDES.join(", ")}.`
    );
  }

  const view = new DataView(
    figBytes.buffer,
    figBytes.byteOffset,
    figBytes.byteLength
  );
  const version = view.getUint32(8, true);
  const schemaLength = view.getUint32(12, true);
  const dataOffset = 16 + schemaLength;
  const dataLength = view.getUint32(dataOffset, true);

  const schemaBytes = decompressChunk(figBytes.subarray(16, 16 + schemaLength));
  const dataBytes = decompressChunk(
    figBytes.subarray(dataOffset + 4, dataOffset + 4 + dataLength)
  );

  const schema = readSchema(schemaBytes, version);
  const rootIndex = schema.types.findIndex((t) => t.name === ROOT_TYPE_NAME);
  if (rootIndex === -1) {
    throw new Error(`No root '${ROOT_TYPE_NAME}' type found in schema`);
  }

  const message = decodeType(
    new KiwiReader(dataBytes),
    schema.types,
    rootIndex,
    false
  ) as Record<string, unknown>;

  return { prelude, version, schema, message };
}
