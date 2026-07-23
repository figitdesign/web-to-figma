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

// The passed element is wrapped in a synthetic paste-template frame (localID 2),
// so the passed element is localID 3 and its first child is localID 4.
const frameByLocalID = (
  changes: ReadonlyArray<FigmaNodeChange>,
  localID: number
): FigmaFrameNodeChange | undefined =>
  changes.find(
    (change): change is FigmaFrameNodeChange =>
      change.type === "FRAME" && change.guid.localID === localID
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pure-ring box-shadow → OUTSIDE stroke", () => {
  it("promotes `0 0 0 <spread>` to an OUTSIDE stroke and drops the effect", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:140px;height:100px;background:#f472b6;border-radius:8px;box-shadow:0 0 0 6px #be185d"></div>
      </div>`
    );

    const changes = await convert(element);
    const ring = frameByLocalID(changes, 4);
    expect(ring).toBeDefined();

    // The ring becomes an OUTSIDE stroke whose weight equals the CSS spread.
    expect(ring?.strokeAlign).toBe("OUTSIDE");
    expect(ring?.strokeWeight).toBe(6);
    expect(ring?.strokePaints).toHaveLength(1);
    const paint = ring?.strokePaints?.[0];
    // #be185d
    if (paint?.type === "SOLID") {
      expect(paint.color.r).toBeCloseTo(0.745, 2);
      expect(paint.color.g).toBeCloseTo(0.094, 2);
      expect(paint.color.b).toBeCloseTo(0.365, 2);
    } else {
      expect.fail("expected a SOLID stroke paint");
    }

    // The invisible drop-shadow must not linger as an effect.
    expect(ring?.effects ?? []).toHaveLength(0);
    // The stroke follows the corner radius, matching the CSS ring.
    expect(ring?.cornerRadius).toBe(8);
    // The node size is unchanged; the OUTSIDE stroke extends beyond it.
    expect(ring?.size).toEqual({ x: 140, y: 100 });
  });

  it("keeps a blur/offset shadow as a DROP_SHADOW effect (no stroke)", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:140px;height:100px;background:#f472b6;box-shadow:0 4px 12px 2px #be185d"></div>
      </div>`
    );

    const changes = await convert(element);
    const shadowed = frameByLocalID(changes, 4);
    expect(shadowed).toBeDefined();

    const dropShadows = (shadowed?.effects ?? []).filter(
      (effect) => effect.type === "DROP_SHADOW"
    );
    expect(dropShadows).toHaveLength(1);
    // Must not have been promoted to an OUTSIDE stroke.
    expect(shadowed?.strokeAlign).not.toBe("OUTSIDE");
    expect(shadowed?.strokePaints ?? []).toHaveLength(0);
  });

  it("lets a real CSS border keep the stroke; ring stays a DROP_SHADOW", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:140px;height:100px;background:#f472b6;border:2px solid #1e293b;box-shadow:0 0 0 6px #be185d"></div>
      </div>`
    );

    const changes = await convert(element);
    const bordered = frameByLocalID(changes, 4);
    expect(bordered).toBeDefined();

    // The CSS border owns the (INSIDE) stroke; it is not clobbered.
    expect(bordered?.strokeAlign).toBe("INSIDE");
    expect(bordered?.strokeWeight).toBe(2);
    expect(bordered?.strokePaints).toHaveLength(1);
    // The ring falls back to the (currently invisible) DROP_SHADOW effect.
    const dropShadows = (bordered?.effects ?? []).filter(
      (effect) => effect.type === "DROP_SHADOW"
    );
    expect(dropShadows).toHaveLength(1);
  });
});

describe("filter: drop-shadow → DROP_SHADOW effect", () => {
  it("maps a filter drop-shadow to a DROP_SHADOW on the frame", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;background:#fff;box-sizing:border-box;padding:30px">
        <div style="width:140px;height:100px;background:#10b981;filter:drop-shadow(8px 8px 5px rgba(0,0,0,0.5))"></div>
      </div>`
    );

    const changes = await convert(element);
    const shadowed = frameByLocalID(changes, 4);
    expect(shadowed).toBeDefined();

    const dropShadows = (shadowed?.effects ?? []).filter(
      (effect) => effect.type === "DROP_SHADOW"
    );
    expect(dropShadows).toHaveLength(1);
    const shadow = dropShadows[0];
    expect(shadow?.offset).toEqual({ x: 8, y: 8 });
    expect(shadow?.radius).toBe(5);
    if (shadow?.type === "DROP_SHADOW") {
      // rgba(0,0,0,0.5): opaque black at 0.5 alpha.
      expect(shadow.color.a).toBeCloseTo(0.5, 5);
    }
  });
});
