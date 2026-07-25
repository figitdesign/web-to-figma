import { afterEach, describe, expect, it } from "vitest";
import { createTestFontLoader } from "./__fixtures__/loaders";
import type { FigmaFrameNodeChange, FigmaNodeChange } from "./converter/types";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 240;
const FRAME_HEIGHT = 180;

const mountElement = (html: string): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as HTMLElement;
};

const convert = async (element: HTMLElement) => {
  const figma = createFigmaConverter({ fontLoader: createTestFontLoader() });
  const result = await figma.convert({
    element,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  });
  return result.document.nodeChanges;
};

const frameByLocalID = (
  changes: ReadonlyArray<FigmaNodeChange>,
  localID: number
): FigmaFrameNodeChange | undefined =>
  changes.find(
    (change): change is FigmaFrameNodeChange =>
      change.type === "FRAME" && change.guid.localID === localID
  );

// #ef4444 in sRGB 0-1; grayscale(1) → Rec.709 luma on every channel.
const RED = { r: 239 / 255, g: 68 / 255, b: 68 / 255 };
const GRAY = 0.2126 * RED.r + 0.7152 * RED.g + 0.0722 * RED.b;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("filter color-matrix → baked fill", () => {
  it("bakes grayscale() into a solid-fill leaf's color", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:120px;height:120px;background:#ef4444;filter:grayscale(1)"></div>
      </div>`
    );

    const changes = await convert(element);
    const leaf = frameByLocalID(changes, 4);
    const fill = leaf?.fillPaints?.[0];
    expect(fill?.type).toBe("SOLID");
    if (fill?.type === "SOLID") {
      expect(fill.color.r).toBeCloseTo(GRAY, 3);
      expect(fill.color.g).toBeCloseTo(GRAY, 3);
      expect(fill.color.b).toBeCloseTo(GRAY, 3);
    }
  });

  it("does NOT bake when the filtered element has children (avoids a partial filter)", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:120px;height:120px;background:#ef4444;filter:grayscale(1)">
          <div style="width:40px;height:40px;background:#1d4ed8"></div>
        </div>
      </div>`
    );

    const changes = await convert(element);
    const container = frameByLocalID(changes, 4);
    const fill = container?.fillPaints?.[0];
    expect(fill?.type).toBe("SOLID");
    if (fill?.type === "SOLID") {
      // Left unfiltered: baking only the bg would leave the child unfiltered.
      expect(fill.color.r).toBeCloseTo(RED.r, 3);
      expect(fill.color.g).toBeCloseTo(RED.g, 3);
      expect(fill.color.b).toBeCloseTo(RED.b, 3);
    }
  });
});
