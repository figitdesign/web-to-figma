import { afterEach, describe, expect, it } from "vitest";
import {
  QUAD_PNG_DATA_URL,
  TINY_RED_PNG_DATA_URL,
} from "./__fixtures__/loaders";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;
const RED_PNG_BYTE_COUNT = 69;
const RED_PNG_SHA1_HEX = "2732f12a8f18d27cf0fa78ef41091bfa1ccec9ce";

const mountElement = (html: string): Promise<HTMLElement> => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  const element = wrapper.firstElementChild as HTMLElement;

  // Wait for any nested <img> elements to load before assertions hit
  // `getBoundingClientRect`, otherwise width/height come back as 0.
  const images = Array.from(element.querySelectorAll("img"));
  const pending = images
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    );
  return Promise.all(pending).then(() => element);
};

const toHex = (bytes: ReadonlyArray<number>): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

const imageBlobOf = (
  result: Awaited<
    ReturnType<ReturnType<typeof createFigmaConverter>["convert"]>
  >
): ReadonlyArray<number> | undefined => {
  const imageNode = result.document.nodeChanges.find(
    (change) => change.type === "ROUNDED_RECTANGLE" && change.name === "Image"
  );
  const fill =
    imageNode?.type === "ROUNDED_RECTANGLE"
      ? imageNode.fillPaints?.find((paint) => paint.type === "IMAGE")
      : undefined;
  if (fill?.type !== "IMAGE") {
    return;
  }
  return result.document.blobs[fill.image.dataBlob ?? -1]?.bytes;
};

/** Read width/height out of a PNG's IHDR, which starts at byte 16. */
const pngSize = (
  bytes: ReadonlyArray<number>
): { width: number; height: number } => {
  const view = new DataView(new Uint8Array(bytes).buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("image rendering with inline PNG", () => {
  it("emits an IMAGE fillPaint and registers the image bytes as a blob", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="${TINY_RED_PNG_DATA_URL}" width="40" height="40" alt="red"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const imageNode = result.document.nodeChanges.find(
      (change) => change.type === "ROUNDED_RECTANGLE" && change.name === "Image"
    );
    expect(imageNode?.type).toBe("ROUNDED_RECTANGLE");
    if (imageNode?.type !== "ROUNDED_RECTANGLE") {
      return;
    }

    const imageFill = imageNode.fillPaints?.find(
      (paint) => paint.type === "IMAGE"
    );
    expect(imageFill?.type).toBe("IMAGE");
    if (imageFill?.type !== "IMAGE") {
      return;
    }

    expect(imageFill.image.dataBlob).toBeTypeOf("number");
    expect(toHex(imageFill.image.hash)).toBe(RED_PNG_SHA1_HEX);

    const blob = result.document.blobs[imageFill.image.dataBlob ?? -1];
    expect(blob).toBeDefined();
    expect(blob?.bytes).toHaveLength(RED_PNG_BYTE_COUNT);
  });

  it("preserves the rendered image dimensions on the node", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="${TINY_RED_PNG_DATA_URL}" width="50" height="30" alt="red"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const imageNode = result.document.nodeChanges.find(
      (change) => change.type === "ROUNDED_RECTANGLE" && change.name === "Image"
    );
    expect(imageNode?.size).toEqual({ x: 50, y: 30 });
  });
});

describe("enlarged images", () => {
  it("re-encodes the bitmap at the size the page paints it", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="${QUAD_PNG_DATA_URL}" style="width:80px;height:40px;display:block" alt="quad"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const blob = imageBlobOf(result);
    expect(blob).toBeDefined();
    expect(pngSize(blob ?? [])).toEqual({ width: 80, height: 40 });
  });

  it("leaves a bitmap the page shrinks at its original resolution", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="${QUAD_PNG_DATA_URL}" style="width:4px;height:4px;display:block" alt="quad"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const blob = imageBlobOf(result);
    expect(pngSize(blob ?? [])).toEqual({ width: 8, height: 8 });
  });
});

describe("broken images", () => {
  it("keeps the node and marks the empty slot with a placeholder outline", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="does-not-exist.png" style="width:60px;height:40px;display:block" alt="missing"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const imageNode = result.document.nodeChanges.find(
      (change) => change.type === "ROUNDED_RECTANGLE" && change.name === "Image"
    );
    expect(imageNode?.size).toEqual({ x: 60, y: 40 });
    if (imageNode?.type !== "ROUNDED_RECTANGLE") {
      return;
    }

    expect(imageNode.fillPaints).toEqual([]);
    expect(imageNode.strokeWeight).toBe(1);
    const stroke = imageNode.strokePaints?.[0];
    expect(stroke?.type).toBe("SOLID");
    if (stroke?.type !== "SOLID") {
      return;
    }
    expect(stroke.color.r).toBeCloseTo(192 / 255, 3);
    expect(stroke.color.g).toBeCloseTo(192 / 255, 3);
    expect(stroke.color.b).toBeCloseTo(192 / 255, 3);
  });

  it("keeps the element's own border instead of the placeholder outline", async () => {
    const element = await mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"><img src="does-not-exist.png" style="width:60px;height:40px;display:block;border:3px solid #ff0000" alt="missing"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const imageNode = result.document.nodeChanges.find(
      (change) => change.type === "ROUNDED_RECTANGLE" && change.name === "Image"
    );
    if (imageNode?.type !== "ROUNDED_RECTANGLE") {
      expect.unreachable("expected an image node");
      return;
    }
    expect(imageNode.strokeWeight).toBe(3);
    const stroke = imageNode.strokePaints?.[0];
    if (stroke?.type !== "SOLID") {
      expect.unreachable("expected a solid stroke");
      return;
    }
    expect(stroke.color.r).toBeCloseTo(1, 3);
    expect(stroke.color.g).toBeCloseTo(0, 3);
  });
});
