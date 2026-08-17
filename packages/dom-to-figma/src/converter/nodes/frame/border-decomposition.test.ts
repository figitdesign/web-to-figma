import { describe, expect, it } from "vitest";
import type { FigmaGuid } from "../../types";
import { decomposePerSideBorder } from "./border-decomposition";

/**
 * The dash counts here are Chrome's, measured off the raster of the
 * `bord/bord-05-dashed` and `bord/bord-06-dotted` scenes — a 172×92 border box
 * with a 6px border. Chrome fits each side on its own, landing a dash in every
 * corner: 10 dashes across the 172px sides and 6 down the 92px ones, and 15/8
 * dots for the same box `dotted`.
 */
const BOX = { width: 172, height: 92 };
const BLUE = "rgb(29, 78, 216)";

function computedStyle(
  overrides: Partial<Record<string, string>>
): CSSStyleDeclaration {
  const base: Record<string, string> = {
    "border-top-width": "6px",
    "border-right-width": "6px",
    "border-bottom-width": "6px",
    "border-left-width": "6px",
    "border-top-color": BLUE,
    "border-right-color": BLUE,
    "border-bottom-color": BLUE,
    "border-left-color": BLUE,
    "border-top-left-radius": "0px",
    "border-top-right-radius": "0px",
    "border-bottom-right-radius": "0px",
    "border-bottom-left-radius": "0px",
    ...overrides,
  };
  return {
    borderColor: BLUE,
    getPropertyValue: (prop: string) => base[prop] ?? "",
  } as unknown as CSSStyleDeclaration;
}

function sideStyles(top: string, right: string, bottom: string, left: string) {
  return {
    "border-top-style": top,
    "border-right-style": right,
    "border-bottom-style": bottom,
    "border-left-style": left,
  };
}

function decompose(overrides: Partial<Record<string, string>>) {
  let next = 0;
  const createGuid = (): FigmaGuid => ({ sessionID: 0, localID: ++next });
  return decomposePerSideBorder({
    computedStyle: computedStyle(overrides),
    ...BOX,
    frameGuid: { sessionID: 0, localID: 0 },
    createGuid,
    registerBlob: () => 0,
  });
}

/** The frame-local box of a painted piece. */
function boxOf(node: NonNullable<ReturnType<typeof decompose>>[number]) {
  return {
    x: node.transform?.m02 ?? 0,
    y: node.transform?.m12 ?? 0,
    width: node.size?.x ?? 0,
    height: node.size?.y ?? 0,
  };
}

/** Nodes lying on the top edge — the only ones 6px tall at y = 0. */
function onTopEdge(nodes: ReturnType<typeof decompose>) {
  return (nodes ?? [])
    .map(boxOf)
    .filter((box) => box.y === 0 && box.height === 6);
}

describe("decomposePerSideBorder() dash fitting", () => {
  it("cuts a uniform dashed border into Chrome's per-side dashes", () => {
    const nodes = decompose(sideStyles("dashed", "dashed", "dashed", "dashed"));
    const top = onTopEdge(nodes);
    expect(top).toHaveLength(10);
    for (const dash of top) {
      expect(dash.width).toBeCloseTo(12, 5);
    }
    // A dash in each corner: the first starts at the box edge, the last ends on it.
    expect(top[0]?.x).toBeCloseTo(0, 5);
    expect((top.at(-1)?.x ?? 0) + 12).toBeCloseTo(172, 5);
    // 6 dashes down the 92px sides, so 32 pieces in all.
    expect(nodes).toHaveLength(10 + 10 + 6 + 6);
  });

  it("dots a uniform dotted border at the width, not twice it", () => {
    const nodes = decompose(sideStyles("dotted", "dotted", "dotted", "dotted"));
    // 15 dots along each 172px side, 8 down each 92px one. The four corner dots
    // are drawn by both of their sides, exactly as Chrome overdraws them.
    expect(nodes).toHaveLength(15 + 15 + 8 + 8);
    for (const dot of (nodes ?? []).map(boxOf)) {
      expect(dot.width).toBeCloseTo(6, 5);
      expect(dot.height).toBeCloseTo(6, 5);
    }
  });

  it("paints each side in its own style when they disagree", () => {
    const nodes = decompose(sideStyles("solid", "dashed", "dotted", "double"));
    // solid: one trapezoid. dashed right: 6. dotted bottom: 15. double left: 2.
    expect(nodes).toHaveLength(1 + 6 + 15 + 2);
    expect(onTopEdge(nodes)).toHaveLength(1);
  });

  it("keeps the single-stroke fast path for a uniform solid border", () => {
    expect(
      decompose(sideStyles("solid", "solid", "solid", "solid"))
    ).toBeNull();
  });

  it("keeps the fast path for styles it cannot paint per side", () => {
    expect(
      decompose(sideStyles("solid", "dashed", "solid", "hidden"))
    ).toBeNull();
  });
});
