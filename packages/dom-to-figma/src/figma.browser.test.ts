import { afterEach, describe, expect, it } from "vitest";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;

const FIGMA_HTML_MARKER = "(figma)";

const mountElement = (html: string): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as HTMLElement;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createFigmaConverter convert()", () => {
  it("converts a single empty frame to a result with document, bytes, and base64", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#ffffff"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      name: "Hero",
    });

    expect(result.document.type).toBe("NODE_CHANGES");
    expect(result.document.nodeChanges.length).toBeGreaterThanOrEqual(3);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(typeof result.base64).toBe("string");
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it("emits Document, Canvas, and Frame node changes", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const types = result.document.nodeChanges.map((change) => change.type);
    expect(types).toContain("DOCUMENT");
    expect(types).toContain("CANVAS");
    expect(types).toContain("FRAME");
  });

  it("accepts a multi-frame canvas input", async () => {
    const a = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );
    const b = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      frames: [
        {
          element: a,
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          x: 0,
          y: 0,
          name: "A",
        },
        {
          element: b,
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          x: FRAME_WIDTH * 2,
          y: 0,
          name: "B",
        },
      ],
      canvasName: "Landing",
    });

    const canvasChange = result.document.nodeChanges.find(
      (change) => change.type === "CANVAS"
    );
    expect(canvasChange?.name).toBe("Landing");
  });
});

describe("ConvertResult clipboard helpers", () => {
  it("toClipboardItem returns a ClipboardItem with text/html mime type", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const item = result.toClipboardItem();
    expect(item).toBeInstanceOf(ClipboardItem);
    expect(item.types).toContain("text/html");
  });

  it("toClipboardHtml embeds the figma payload identifier", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );

    const figma = createFigmaConverter();
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const html = result.toClipboardHtml();
    expect(typeof html).toBe("string");
    expect(html).toContain("data-buffer=");
    expect(html).toContain(FIGMA_HTML_MARKER);
    expect(html).toContain(result.base64);
  });
});
