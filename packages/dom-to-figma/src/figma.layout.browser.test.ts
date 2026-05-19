import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTestFontLoader,
  loadTestFontIntoBrowser,
  TEST_FONT_FAMILY,
} from "./__fixtures__/loaders";
import type { FigmaNodeChange } from "./converter/types";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;

const mountElement = (html: string): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as HTMLElement;
};

type LayoutSummary = {
  type: FigmaNodeChange["type"];
  name: string;
  parentLocalID: number | null;
  size: { x: number; y: number } | null;
  position: { x: number; y: number } | null;
};

const summarize = (
  changes: ReadonlyArray<FigmaNodeChange>
): Array<LayoutSummary> =>
  changes.map((change) => ({
    type: change.type,
    name: change.name,
    parentLocalID: change.parentIndex?.guid.localID ?? null,
    size: change.size ? { x: change.size.x, y: change.size.y } : null,
    position: change.transform
      ? { x: change.transform.m02, y: change.transform.m12 }
      : null,
  }));

beforeAll(async () => {
  await loadTestFontIntoBrowser();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("layout assertions for nested frames", () => {
  it("preserves a two-column flex layout in the document tree", async () => {
    // Two 100x80 boxes side-by-side inside a 320x200 frame.
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;display:flex;gap:20px;padding:30px 40px;box-sizing:border-box">
        <div data-testid="left" style="width:100px;height:80px;background:#ff0000"></div>
        <div data-testid="right" style="width:100px;height:80px;background:#00ff00"></div>
      </div>`
    );

    const figma = createFigmaConverter({ fontLoader: createTestFontLoader() });
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const changes = result.document.nodeChanges;

    // Document, Canvas, root Frame, outer div Frame, left Frame, right Frame.
    expect(changes).toHaveLength(6);

    const rootFrame = changes.find(
      (change) => change.type === "FRAME" && change.guid.localID === 2
    );
    expect(rootFrame).toBeDefined();

    const childFrames = changes.filter(
      (change) => change.type === "FRAME" && change.guid.localID >= 4
    );
    expect(childFrames).toHaveLength(2);

    // Left box: x = padding-left (40), y = padding-top (30).
    const leftFrame = childFrames[0];
    expect(leftFrame?.size).toEqual({ x: 100, y: 80 });
    expect(leftFrame?.transform?.m02).toBe(40);
    expect(leftFrame?.transform?.m12).toBe(30);

    // Right box: x = 40 + 100 + 20 (gap), y = 30.
    const rightFrame = childFrames[1];
    expect(rightFrame?.size).toEqual({ x: 100, y: 80 });
    expect(rightFrame?.transform?.m02).toBe(160);
    expect(rightFrame?.transform?.m12).toBe(30);
  });

  it("matches the snapshot of a richer layout (frame + text + image)", async () => {
    // 1x1 red PNG; defined inline so the snapshot stays self-contained.
    const tinyRedPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;font-family:'${TEST_FONT_FAMILY}',sans-serif;font-size:16px;padding:20px;box-sizing:border-box">
        <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:700">Title</h1>
        <img src="${tinyRedPng}" width="48" height="48" alt="red" style="display:block;margin-top:12px">
      </div>`
    );

    const figma = createFigmaConverter({ fontLoader: createTestFontLoader() });
    const result = await figma.convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    expect(summarize(result.document.nodeChanges)).toMatchInlineSnapshot(`
      [
        {
          "name": "Unnamed",
          "parentLocalID": null,
          "position": null,
          "size": null,
          "type": "DOCUMENT",
        },
        {
          "name": "Frame",
          "parentLocalID": 0,
          "position": {
            "x": 0,
            "y": 0,
          },
          "size": null,
          "type": "CANVAS",
        },
        {
          "name": "Frame",
          "parentLocalID": 1,
          "position": {
            "x": 0,
            "y": 0,
          },
          "size": {
            "x": 320,
            "y": 200,
          },
          "type": "FRAME",
        },
        {
          "name": "Container",
          "parentLocalID": 2,
          "position": {
            "x": 0,
            "y": 0,
          },
          "size": {
            "x": 320,
            "y": 200,
          },
          "type": "FRAME",
        },
        {
          "name": "Title",
          "parentLocalID": 3,
          "position": {
            "x": 18.5,
            "y": 20,
          },
          "size": {
            "x": 283,
            "y": 32,
          },
          "type": "TEXT",
        },
        {
          "name": "Image",
          "parentLocalID": 3,
          "position": {
            "x": 20,
            "y": 64,
          },
          "size": {
            "x": 48,
            "y": 48,
          },
          "type": "ROUNDED_RECTANGLE",
        },
      ]
    `);
  });
});
