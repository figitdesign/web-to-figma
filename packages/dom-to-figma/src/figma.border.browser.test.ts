import { afterEach, describe, expect, it } from "vitest";
import type {
  FigmaFrameNodeChange,
  FigmaNodeChange,
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

const convert = async (innerStyle: string) => {
  const element = mountElement(
    `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:20px">
      <div style="width:160px;height:80px;background:#fff;${innerStyle}"></div>
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

const rgb255 = (paint: { color: { r: number; g: number; b: number } }) =>
  [
    Math.round(paint.color.r * 255),
    Math.round(paint.color.g * 255),
    Math.round(paint.color.b * 255),
  ].join(",");

const vectors = (changes: ReadonlyArray<FigmaNodeChange>) =>
  changes.filter((c): c is FigmaVectorNodeChange => c.type === "VECTOR");

const frames = (changes: ReadonlyArray<FigmaNodeChange>) =>
  changes.filter((c): c is FigmaFrameNodeChange => c.type === "FRAME");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("per-side border color decomposition (BORD-03)", () => {
  it("splits four different border colors into four filled trapezoids", async () => {
    const changes = await convert(
      "border:10px solid;border-top-color:#ef4444;border-right-color:#22c55e;border-bottom-color:#3b82f6;border-left-color:#f59e0b"
    );

    const borderVectors = vectors(changes);
    expect(borderVectors).toHaveLength(4);

    // All four are children of the same (bordered) frame.
    const parentIds = new Set(
      borderVectors.map((v) => v.parentIndex?.guid.localID)
    );
    expect(parentIds.size).toBe(1);
    const parentId = borderVectors[0]?.parentIndex?.guid.localID;
    const borderedFrame = frames(changes).find(
      (f) => f.guid.localID === parentId
    );

    // The frame itself paints no stroke — the sides carry the color now.
    expect(borderedFrame?.strokeWeight).toBe(0);
    expect(borderedFrame?.strokePaints ?? []).toHaveLength(0);
    // Background fill is untouched.
    expect(borderedFrame?.fillPaints?.length).toBeGreaterThan(0);

    // Each side is a solid fill (no stroke) of its own CSS color.
    const bySize = (v: FigmaVectorNodeChange) => `${v.size?.x}x${v.size?.y}`;
    const geometry = new Map(
      borderVectors.map((v) => {
        const paint = v.fillPaints?.[0];
        expect(paint?.type).toBe("SOLID");
        expect(v.strokePaints ?? []).toHaveLength(0);
        return [
          rgb255(paint as { color: { r: number; g: number; b: number } }),
          {
            size: bySize(v),
            pos: `${v.transform?.m02},${v.transform?.m12}`,
          },
        ];
      })
    );

    // Four distinct colors survived (no collapse to the top color).
    expect(geometry.size).toBe(4);

    // Inner border-box is 180×100 (160+20 content-box + 10 border each side).
    // Top runs the full width at the top; left runs the full height at x=0; etc.
    expect(geometry.get("239,68,68")).toEqual({ size: "180x10", pos: "0,0" }); // red top
    expect(geometry.get("34,197,94")).toEqual({ size: "10x100", pos: "170,0" }); // green right
    expect(geometry.get("59,130,246")).toEqual({ size: "180x10", pos: "0,90" }); // blue bottom
    expect(geometry.get("245,158,11")).toEqual({ size: "10x100", pos: "0,0" }); // orange left
  });

  it("keeps a single stroke for a uniform border (fast path, no vectors)", async () => {
    const changes = await convert("border:10px solid #ef4444");

    expect(vectors(changes)).toHaveLength(0);
    const borderedFrame = frames(changes).find((f) => f.strokeWeight === 10);
    expect(borderedFrame?.strokePaints).toHaveLength(1);
    expect(rgb255(borderedFrame?.strokePaints?.[0] as never)).toBe("239,68,68");
  });

  it("paints a mixed-style border side by side, each in its own style", async () => {
    // A 170×90 border box with a 5px border. Chrome fits each side's dashes on
    // its own: 6 dashes down the 90px right side, 18 dots along the 170px
    // bottom. Solid stays one trapezoid and double becomes two.
    const changes = await convert(
      "border-top:5px solid #f59e0b;border-right:5px dashed #8b5cf6;border-bottom:5px dotted #ef4444;border-left:5px double #06b6d4"
    );

    const byColor = new Map<string, number>();
    for (const vector of vectors(changes)) {
      const color = rgb255(vector.fillPaints?.[0] as never);
      byColor.set(color, (byColor.get(color) ?? 0) + 1);
    }
    expect(byColor.get("245,158,11")).toBe(1); // solid top
    expect(byColor.get("139,92,246")).toBe(6); // dashed right
    expect(byColor.get("239,68,68")).toBe(18); // dotted bottom
    expect(byColor.get("6,182,212")).toBe(2); // double left
  });

  it("keeps the single-stroke fast path when only widths differ (same color)", async () => {
    const changes = await convert(
      "border-style:solid;border-color:#ef4444;border-top-width:4px;border-right-width:10px;border-bottom-width:4px;border-left-width:10px"
    );

    // Same color on every side → per-side stroke weights already express this,
    // so no decomposition (and no regression of BORD width handling).
    expect(vectors(changes)).toHaveLength(0);
    const borderedFrame = frames(changes).find(
      (f) => (f.strokePaints?.length ?? 0) === 1
    );
    expect(borderedFrame?.borderStrokeWeightsIndependent).toBe(true);
    expect(borderedFrame?.borderTopWeight).toBe(4);
    expect(borderedFrame?.borderLeftWeight).toBe(10);
  });
});
