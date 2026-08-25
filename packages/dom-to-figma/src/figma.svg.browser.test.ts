import { afterEach, describe, expect, it } from "vitest";
import type {
  FigmaFrameNodeChange,
  FigmaNodeChange,
  FigmaPaint,
  FigmaTextNodeChange,
  FigmaVectorNodeChange,
} from "./converter/types";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 240;
const FRAME_HEIGHT = 160;

const mountElement = (html: string): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as HTMLElement;
};

const convert = async (svgBody: string) => {
  const element = mountElement(
    `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:20px">
      <svg width="200" height="120" viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">${svgBody}</svg>
    </div>`
  );
  const figma = createFigmaConverter();
  const result = await figma.convert({
    element,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  });
  return result.document.nodeChanges;
};

const vectors = (changes: ReadonlyArray<FigmaNodeChange>) =>
  changes.filter((c): c is FigmaVectorNodeChange => c.type === "VECTOR");

const clipFrames = (changes: ReadonlyArray<FigmaNodeChange>) =>
  changes.filter(
    (c): c is FigmaFrameNodeChange => c.type === "FRAME" && c.name === "Clip"
  );

const rgb255 = (paint: FigmaPaint) =>
  "color" in paint
    ? [
        Math.round(paint.color.r * 255),
        Math.round(paint.color.g * 255),
        Math.round(paint.color.b * 255),
      ].join(",")
    : paint.type;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SVG clip-path (SVG-10)", () => {
  it("wraps a rect-clipped shape in a clipping frame at the clip's box", async () => {
    const changes = await convert(
      `<defs><clipPath id="c"><rect x="10" y="20" width="50" height="50"/></clipPath></defs>
       <rect x="10" y="20" width="80" height="80" fill="#6366f1" clip-path="url(#c)"/>`
    );

    const clips = clipFrames(changes);
    expect(clips).toHaveLength(1);
    const clip = clips[0] as FigmaFrameNodeChange;
    // Clips content, paints nothing of its own.
    expect(clip.frameMaskDisabled).toBe(false);
    expect(clip.fillPaints).toEqual([]);
    // Positioned at the clip rect inside the <svg>, sized to it.
    expect(clip.transform?.m02).toBe(10);
    expect(clip.transform?.m12).toBe(20);
    expect(clip.size).toEqual({ x: 50, y: 50 });

    // The shape keeps its own geometry, offset back inside the clip frame.
    const shape = vectors(changes).find((v) => v.name !== "Clip");
    expect(shape?.parentIndex?.guid).toEqual(clip.guid);
    expect(shape?.size).toEqual({ x: 80, y: 80 });
    expect(shape?.transform?.m02).toBe(0);
    expect(shape?.transform?.m12).toBe(0);

    // A rectangular clip needs no mask; the frame already reproduces it.
    expect(vectors(changes).some((v) => v.mask)).toBe(false);
  });

  it("adds an outline mask under a non-rectangular clip", async () => {
    const changes = await convert(
      `<defs><clipPath id="c"><circle cx="50" cy="60" r="30"/></clipPath></defs>
       <rect x="10" y="20" width="80" height="80" fill="#6366f1" clip-path="url(#c)"/>`
    );

    const clip = clipFrames(changes)[0] as FigmaFrameNodeChange;
    expect(clip.size).toEqual({ x: 60, y: 60 });
    expect(clip.transform?.m02).toBe(20);
    expect(clip.transform?.m12).toBe(30);

    const mask = vectors(changes).find((v) => v.mask);
    expect(mask?.maskType).toBe("OUTLINE");
    expect(mask?.parentIndex?.guid).toEqual(clip.guid);
    expect(mask?.size).toEqual({ x: 60, y: 60 });

    // The mask paints below the shape it masks.
    const shape = vectors(changes).find((v) => !v.mask);
    expect(Number(mask?.parentIndex?.position)).toBeLessThan(
      Number(shape?.parentIndex?.position)
    );
  });

  it("leaves a clip outside the modelled subset unclipped", async () => {
    const changes = await convert(
      `<defs><clipPath id="c"><rect x="10" y="20" width="20" height="20"/><rect x="40" y="20" width="20" height="20"/></clipPath></defs>
       <rect x="10" y="20" width="80" height="80" fill="#6366f1" clip-path="url(#c)"/>`
    );

    expect(clipFrames(changes)).toHaveLength(0);
    expect(vectors(changes)).toHaveLength(1);
  });

  it("does not emit the clipPath's own shapes as nodes", async () => {
    const changes = await convert(
      `<clipPath id="c"><circle cx="50" cy="60" r="30"/></clipPath>
       <rect x="10" y="20" width="80" height="80" fill="#6366f1"/>`
    );

    expect(vectors(changes)).toHaveLength(1);
  });
});

describe("SVG text (SVG-08)", () => {
  const svgText = async (attributes: string) => {
    const changes = await convert(
      `<text x="20" y="70" font-family="Arial" font-size="32" ${attributes}>Figit</text>`
    );
    return changes.find(
      (c): c is FigmaTextNodeChange => c.type === "TEXT"
    ) as FigmaTextNodeChange;
  };

  it("paints glyphs with fill, not the inherited CSS color", async () => {
    const text = await svgText(`fill="#6366f1"`);
    expect(text.fillPaints?.map(rgb255)).toEqual(["99,102,241"]);
  });

  it("applies fill-opacity to the glyph paint", async () => {
    const text = await svgText(`fill="#6366f1" fill-opacity="0.5"`);
    expect(text.fillPaints?.[0]?.opacity).toBeCloseTo(0.5, 5);
  });

  it("emits no fill for fill=none", async () => {
    const text = await svgText(`fill="none"`);
    expect(text.fillPaints).toEqual([]);
  });

  it("uses the measured box as the line height, not 1.2x font size", async () => {
    const text = await svgText(`fill="#6366f1"`);
    // SVG text has no line box: the box is exactly ascent + descent, so any
    // extra leading would push the baseline off the SVG's `y`.
    expect(text.lineHeight?.value).toBe(text.size?.y);
    expect(text.lineHeight?.value).not.toBeCloseTo(32 * 1.2, 5);
  });
});
