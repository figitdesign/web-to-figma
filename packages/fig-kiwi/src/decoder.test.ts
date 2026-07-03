import { zstdCompressSync } from "node:zlib";
import { inflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { composeClipboardHtml, parseClipboardHtml } from "./clipboard";
import { decodeFigmaData } from "./decoder";
import { encodeFigmaData } from "./encoder";
import { KiwiReader } from "./kiwi-reader";
import { KiwiWriter } from "./kiwi-writer";
import { SCHEMA } from "./schema";

describe("KiwiReader", () => {
  it("round-trips primitives written by KiwiWriter", () => {
    const w = new KiwiWriter();
    w.bool(true);
    w.bool(false);
    w.byte(200);
    w.uint(0);
    w.uint(127);
    w.uint(128);
    w.uint(1_000_000);
    w.int(0);
    w.int(42);
    w.int(-42);
    w.int(-1);
    w.string("héllo, kiwi");
    w.string("");

    const r = new KiwiReader(w.getBytes());
    expect(r.bool()).toBe(true);
    expect(r.bool()).toBe(false);
    expect(r.byte()).toBe(200);
    expect(r.uint()).toBe(0);
    expect(r.uint()).toBe(127);
    expect(r.uint()).toBe(128);
    expect(r.uint()).toBe(1_000_000);
    expect(r.int()).toBe(0);
    expect(r.int()).toBe(42);
    expect(r.int()).toBe(-42);
    expect(r.int()).toBe(-1);
    expect(r.string()).toBe("héllo, kiwi");
    expect(r.string()).toBe("");
    expect(r.done).toBe(true);
  });

  it("round-trips float32-exact values exactly", () => {
    const values = [0, 1, -1, 0.5, -0.25, 1.5, 320, 1234.5, -0.001_953_125];
    const w = new KiwiWriter();
    for (const v of values) {
      w.float(v);
    }
    const r = new KiwiReader(w.getBytes());
    for (const v of values) {
      expect(r.float()).toBe(v);
    }
    expect(r.done).toBe(true);
  });

  it("round-trips arbitrary floats to float32 precision", () => {
    const values = [0.1, Math.PI, -123.456, 1e10, 1e-10];
    const w = new KiwiWriter();
    for (const v of values) {
      w.float(v);
    }
    const r = new KiwiReader(w.getBytes());
    for (const v of values) {
      expect(r.float()).toBe(Math.fround(v));
    }
  });

  it("throws when reading past the end of the buffer", () => {
    const r = new KiwiReader(new Uint8Array([1]));
    r.byte();
    expect(() => r.byte()).toThrow(/past end/);
  });
});

// A trimmed but representative clipboard message: document + canvas + an
// auto-layout frame, exercising enums, nested structs, float matrices,
// node-change arrays, and a binary blob. All floats are float32-exact so the
// round-trip can assert deep equality.
const FIXTURE_MESSAGE = {
  type: "NODE_CHANGES",
  sessionID: 0,
  ackID: 0,
  pasteID: 777,
  pasteFileKey: "IAMA_DUMMY_FILE_KEY_AMA",
  pasteIsPartiallyOutsideEnclosingFrame: false,
  isCut: false,
  pasteEditorType: "DESIGN",
  publishedAssetGuids: [],
  nodeChanges: [
    {
      guid: { sessionID: 0, localID: 0 },
      phase: "CREATED",
      type: "DOCUMENT",
      name: "Unnamed",
      visible: true,
      opacity: 1,
      blendMode: "PASS_THROUGH",
      mask: false,
      maskType: "ALPHA",
    },
    {
      guid: { sessionID: 0, localID: 2 },
      phase: "CREATED",
      parentIndex: { guid: { sessionID: 0, localID: 1 }, position: "!" },
      type: "FRAME",
      name: "Card",
      visible: true,
      opacity: 0.5,
      size: { x: 320, y: 200 },
      transform: { m00: 1, m01: 0, m02: 40.5, m10: 0, m11: 1, m12: -30.25 },
      stackMode: "HORIZONTAL",
      stackSpacing: 20,
      stackHorizontalPadding: 40,
      stackVerticalPadding: 30,
      stackPrimaryAlignItems: "SPACE_BETWEEN",
      stackCounterAlignItems: "CENTER",
      stackChildPrimaryGrow: 1,
      fillPaints: [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0.25, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: "NORMAL",
        },
      ],
    },
  ],
  blobs: [{ bytes: new Uint8Array([0, 1, 2, 250, 255]) }],
};

describe("decodeFigmaData", () => {
  it("round-trips the encoder's output", () => {
    const { figBytes } = encodeFigmaData(FIXTURE_MESSAGE);
    const decoded = decodeFigmaData(figBytes);

    expect(decoded.prelude).toBe("fig-kiwi");
    expect(decoded.version).toBe(SCHEMA.version);
    expect(decoded.message).toEqual(FIXTURE_MESSAGE);
  });

  it("re-reads the embedded schema faithfully", () => {
    const { figBytes } = encodeFigmaData({});
    const decoded = decodeFigmaData(figBytes);

    expect(decoded.schema.type_count).toBe(SCHEMA.type_count);
    const stackMode = decoded.schema.types.find((t) => t.name === "StackMode");
    expect(stackMode?.kind_name).toBe("enum");
    expect(Object.values(stackMode?.fields ?? {}).map((f) => f.name)).toContain(
      "HORIZONTAL"
    );
  });

  it("rejects bytes without a fig prelude", () => {
    expect(() => decodeFigmaData(new Uint8Array(32))).toThrow(/prelude/);
  });

  // Figma (as of 2026) writes the data chunk zstd-compressed while the schema
  // chunk stays deflate. Rebuild the encoder's output that way and make sure
  // the decoder's per-chunk sniffing handles it. Node gained zstd in v23, so
  // guard for older runtimes; CI runs new enough Node for this to execute.
  it.runIf(typeof zstdCompressSync === "function")(
    "decodes a zstd-compressed data chunk like Figma's copy output",
    () => {
      const { figBytes } = encodeFigmaData(FIXTURE_MESSAGE);
      const view = new DataView(
        figBytes.buffer,
        figBytes.byteOffset,
        figBytes.byteLength
      );
      const schemaLength = view.getUint32(12, true);
      const dataOffset = 16 + schemaLength;
      const dataLength = view.getUint32(dataOffset, true);

      const deflatedData = figBytes.subarray(
        dataOffset + 4,
        dataOffset + 4 + dataLength
      );
      const zstdData = new Uint8Array(
        zstdCompressSync(inflateSync(deflatedData))
      );

      const rebuilt = new Uint8Array(dataOffset + 4 + zstdData.length);
      rebuilt.set(figBytes.subarray(0, dataOffset));
      new DataView(rebuilt.buffer).setUint32(dataOffset, zstdData.length, true);
      rebuilt.set(zstdData, dataOffset + 4);

      expect(decodeFigmaData(rebuilt).message).toEqual(FIXTURE_MESSAGE);
    }
  );
});

describe("parseClipboardHtml", () => {
  it("round-trips our own envelope", () => {
    const { figBytes, base64 } = encodeFigmaData(FIXTURE_MESSAGE);
    const html = composeClipboardHtml(base64, {
      dataType: "scene",
      fileKey: "abc123",
      pasteID: 42,
    });

    const parsed = parseClipboardHtml(html);
    expect(parsed.fig).toEqual(figBytes);
    expect(parsed.meta).toEqual({
      dataType: "scene",
      fileKey: "abc123",
      pasteID: 42,
    });
    expect(decodeFigmaData(parsed.fig).message).toEqual(FIXTURE_MESSAGE);
  });

  it("handles entity-encoded markers as written by clipboard serializers", () => {
    const { figBytes, base64 } = encodeFigmaData(FIXTURE_MESSAGE);
    const html = composeClipboardHtml(base64)
      .replaceAll("<!--(", "&lt;!--(")
      .replaceAll(")-->", ")--&gt;");

    const parsed = parseClipboardHtml(html);
    expect(parsed.fig).toEqual(figBytes);
  });

  it("handles Figma's own top-level comment markers", () => {
    const { figBytes, base64 } = encodeFigmaData(FIXTURE_MESSAGE);
    const metaB64 = btoa(
      JSON.stringify({ fileKey: "k", pasteID: 1, dataType: "scene" })
    );
    const html = `<meta charset="utf-8"><!--(figmeta)${metaB64}(/figmeta)--><!--(figma)${base64}(/figma)--><span></span>`;

    const parsed = parseClipboardHtml(html);
    expect(parsed.fig).toEqual(figBytes);
    expect(parsed.meta?.fileKey).toBe("k");
  });

  it("throws a descriptive error when markers are missing", () => {
    expect(() => parseClipboardHtml("<div>not figma</div>")).toThrow(
      /payload markers/
    );
  });
});
