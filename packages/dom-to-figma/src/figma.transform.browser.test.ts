import { afterEach, describe, expect, it } from "vitest";
import { createTestFontLoader } from "./__fixtures__/loaders";
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
) =>
  changes.find(
    (change) => change.type === "FRAME" && change.guid.localID === localID
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("css transform preservation", () => {
  it("gives a rotated leaf its untransformed size and rotation matrix", async () => {
    // 100x80 box at (40,30), rotated 90° about its center (105,95 → bbox
    // 80x100 with top-left at (50,20)).
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;position:relative">
        <div style="position:absolute;left:40px;top:30px;width:100px;height:80px;background:#6366f1;transform:rotate(90deg)"></div>
      </div>`
    );

    const changes = await convert(element);
    const rotated = frameByLocalID(changes, 4);
    expect(rotated).toBeDefined();

    // Untransformed layout size, not the 80x100 bounding box.
    expect(rotated?.size).toEqual({ x: 100, y: 80 });
    // cos90/sin90 linear part.
    expect(rotated?.transform?.m00).toBeCloseTo(0, 5);
    expect(rotated?.transform?.m10).toBeCloseTo(1, 5);
    expect(rotated?.transform?.m01).toBeCloseTo(-1, 5);
    expect(rotated?.transform?.m11).toBeCloseTo(0, 5);
    // Translation places the untransformed box so its center lands on the
    // rendered center (90,70): m02 = 90 - (0*50 + -1*40), m12 = 70 - (1*50).
    expect(rotated?.transform?.m02).toBeCloseTo(130, 3);
    expect(rotated?.transform?.m12).toBeCloseTo(20, 3);
  });

  it("keeps the flattened bbox on a transformed element with children", async () => {
    // In Figma a node's matrix applies to its whole subtree, but children are
    // measured in transformed screen space — a matrix here would transform
    // them twice. Parents with children keep the axis-aligned bbox instead.
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;position:relative">
        <div style="position:absolute;left:40px;top:30px;width:100px;height:80px;background:#6366f1;transform:rotate(90deg)">
          <div style="width:20px;height:20px;background:#ec4899"></div>
        </div>
      </div>`
    );

    const changes = await convert(element);
    const parent = frameByLocalID(changes, 4);
    expect(parent).toBeDefined();

    // Identity linear part: the bbox frame, not the rotation matrix.
    expect(parent?.transform?.m00).toBe(1);
    expect(parent?.transform?.m01).toBe(0);
    expect(parent?.transform?.m10).toBe(0);
    expect(parent?.transform?.m11).toBe(1);
    // The 90°-rotated 100x80 box has an 80x100 bbox at (50,20).
    expect(parent?.size).toEqual({ x: 80, y: 100 });
    expect(parent?.transform?.m02).toBeCloseTo(50, 3);
    expect(parent?.transform?.m12).toBeCloseTo(20, 3);

    // The child stays its layout size — not an enlarged rotated bbox — and
    // sits at its bbox offset inside the parent bbox (no double transform).
    const child = frameByLocalID(changes, 5);
    expect(child).toBeDefined();
    expect(child?.size).toEqual({ x: 20, y: 20 });
    expect(child?.transform?.m00).toBe(1);
    expect(child?.transform?.m02).toBeCloseTo(60, 3);
    expect(child?.transform?.m12).toBeCloseTo(0, 3);
  });
});
