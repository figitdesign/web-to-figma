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

const sceneWithBlend = (mixBlendMode: string) =>
  `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;position:relative">
    <div style="position:absolute;left:25px;top:40px;width:110px;height:100px;background:#1d4ed8"></div>
    <div style="position:absolute;left:105px;top:40px;width:110px;height:100px;background:#f59e0b;mix-blend-mode:${mixBlendMode}"></div>
  </div>`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mix-blend-mode → node blendMode", () => {
  it("carries multiply onto the blended frame only", async () => {
    const element = mountElement(sceneWithBlend("multiply"));

    const changes = await convert(element);

    expect(frameByLocalID(changes, 5)?.blendMode).toBe("MULTIPLY");
    // The unblended sibling keeps Figma's PASS_THROUGH default.
    expect(frameByLocalID(changes, 4)?.blendMode).toBeUndefined();
  });

  it("leaves mix-blend-mode: normal at the PASS_THROUGH default", async () => {
    const element = mountElement(sceneWithBlend("normal"));

    const changes = await convert(element);

    expect(frameByLocalID(changes, 5)?.blendMode).toBeUndefined();
  });

  it("maps a hyphenated keyword to its Figma name", async () => {
    const element = mountElement(sceneWithBlend("color-dodge"));

    const changes = await convert(element);

    expect(frameByLocalID(changes, 5)?.blendMode).toBe("COLOR_DODGE");
  });
});
