import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTestFontLoader,
  loadTestFontIntoBrowser,
  TEST_FONT_FAMILY,
} from "./__fixtures__/loaders";
import { getTextSize } from "./converter/dom";
import type { FigmaFrameNodeChange, FigmaNodeChange } from "./converter/types";
import type { ConverterLayout } from "./converter/walk";
import { createFigmaConverter } from "./figma";

beforeAll(async () => {
  await loadTestFontIntoBrowser();
});

afterEach(() => {
  document.body.innerHTML = "";
});

const convertScene = async (
  html: string,
  layout: ConverterLayout = "auto"
): Promise<ReadonlyArray<FigmaNodeChange>> => {
  const wrapper = document.createElement("div");
  // Sized larger than any scene so the legacy fill heuristics (which fire
  // when an element matches its parent's size) never trigger on the scene
  // element by harness coincidence.
  wrapper.style.width = "400px";
  wrapper.style.height = "300px";
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  const element = wrapper.firstElementChild as HTMLElement;

  const figma = createFigmaConverter({
    layout,
    fontLoader: createTestFontLoader(),
  });
  const result = await figma.convert({ element, width: 400, height: 300 });
  return result.document.nodeChanges;
};

// The converted element is always the first walked node: localID 3
// (0 document, 1 canvas, 2 root frame).
const CONTAINER_LOCAL_ID = 3;

// Every node these tests look up is a frame; narrow so stack fields typecheck.
const byLocalId = (
  changes: ReadonlyArray<FigmaNodeChange>,
  localID: number
): FigmaFrameNodeChange | undefined =>
  changes.find((change) => change.guid.localID === localID) as
    | FigmaFrameNodeChange
    | undefined;

describe("auto-layout inference for flex containers", () => {
  it("maps a row with gap and padding to HORIZONTAL auto-layout", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;gap:20px;padding:30px 40px;box-sizing:border-box">
        <div style="width:100px;height:80px"></div>
        <div style="width:100px;height:80px"></div>
      </div>`
    );

    const container = byLocalId(changes, CONTAINER_LOCAL_ID);
    expect(container).toMatchObject({
      stackMode: "HORIZONTAL",
      stackSpacing: 20,
      stackPrimaryAlignItems: "MIN",
      stackCounterAlignItems: "MIN",
      stackHorizontalPadding: 40,
      stackVerticalPadding: 30,
      stackPaddingRight: 40,
      stackPaddingBottom: 30,
      // Explicit on purpose: pasting a stack without sizing modes makes
      // Figma hug-to-content and shrink the frame (oracle batch-01).
      stackPrimarySizing: "FIXED",
      stackCounterSizing: "FIXED",
    });
  });

  it("maps flex-direction column to VERTICAL", async () => {
    const changes = await convertScene(
      `<div style="width:200px;height:300px;display:flex;flex-direction:column;gap:12px">
        <div style="width:100px;height:40px"></div>
        <div style="width:100px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 12,
    });
  });

  it("maps justify-content and align-items to stack alignments", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;justify-content:space-between;align-items:center;padding:10px;box-sizing:border-box">
        <div style="width:60px;height:40px"></div>
        <div style="width:60px;height:40px"></div>
        <div style="width:60px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackPrimaryAlignItems: "SPACE_BETWEEN",
      stackCounterAlignItems: "CENTER",
    });
  });

  it("maps justify-content center on both axes", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;justify-content:center;align-items:flex-end">
        <div style="width:60px;height:40px"></div>
        <div style="width:60px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackPrimaryAlignItems: "CENTER",
      stackCounterAlignItems: "MAX",
    });
  });

  it("maps space-evenly and space-around to CENTER with measured spacing", async () => {
    // Figma stores SPACE_EVENLY but renders it as space-between (oracle
    // batch-01), so both distributions ride on CENTER + real gap instead.
    const evenly = await convertScene(
      `<div style="width:320px;height:140px;display:flex;justify-content:space-evenly">
        <div style="width:56px;height:44px"></div>
        <div style="width:56px;height:44px"></div>
        <div style="width:56px;height:44px"></div>
      </div>`
    );
    expect(byLocalId(evenly, CONTAINER_LOCAL_ID)).toMatchObject({
      stackPrimaryAlignItems: "CENTER",
      stackSpacing: 38,
    });

    const around = await convertScene(
      `<div style="width:320px;height:140px;display:flex;justify-content:space-around">
        <div style="width:56px;height:44px"></div>
        <div style="width:56px;height:44px"></div>
      </div>`
    );
    expect(byLocalId(around, CONTAINER_LOCAL_ID)).toMatchObject({
      stackPrimaryAlignItems: "CENTER",
      stackSpacing: 104,
    });
  });

  it("derives spacing from uniform margins when there is no gap", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex">
        <div style="width:60px;height:40px;margin-right:12px"></div>
        <div style="width:60px;height:40px;margin-right:12px"></div>
        <div style="width:60px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackSpacing: 12,
    });
  });

  it("folds borders into padding so children keep their offsets", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;border:2px solid #000;padding:10px;box-sizing:border-box">
        <div style="width:60px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackHorizontalPadding: 12,
      stackVerticalPadding: 12,
      stackPaddingRight: 12,
      stackPaddingBottom: 12,
    });
  });

  it("drops fill heuristics on children of an inferred stack", async () => {
    // The child fills the row's height, which previously produced
    // stackChildPrimaryGrow — horizontal growth inside a HORIZONTAL stack.
    const changes = await convertScene(
      `<div style="width:320px;height:70px;display:flex;gap:10px">
        <div style="width:80px;height:70px"></div>
        <div style="width:80px;height:70px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe(
      "HORIZONTAL"
    );
    const child = byLocalId(changes, CONTAINER_LOCAL_ID + 1);
    expect(child?.stackChildPrimaryGrow).toBeUndefined();
    expect(child?.stackChildAlignSelf).toBeUndefined();
  });

  it("marks a flex-grow child as fill-container", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:80px;display:flex;gap:20px">
        <div style="width:100px;height:80px"></div>
        <div style="flex:1 1 0;height:80px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe(
      "HORIZONTAL"
    );
    const fixed = byLocalId(changes, CONTAINER_LOCAL_ID + 1);
    const filled = byLocalId(changes, CONTAINER_LOCAL_ID + 2);
    expect(fixed?.stackChildPrimaryGrow).toBeUndefined();
    expect(filled?.stackChildPrimaryGrow).toBe(1);
  });

  it("keeps unequal-ratio grow children fixed but still converts the stack", async () => {
    // 2:1 grow ratios don't match Figma's equal-split fill model, so the
    // children stay fixed at their final sizes; geometry is unaffected.
    const changes = await convertScene(
      `<div style="width:320px;height:80px;display:flex">
        <div style="flex:2 1 0;height:80px"></div>
        <div style="flex:1 1 0;height:80px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe(
      "HORIZONTAL"
    );
    expect(
      byLocalId(changes, CONTAINER_LOCAL_ID + 1)?.stackChildPrimaryGrow
    ).toBeUndefined();
    expect(
      byLocalId(changes, CONTAINER_LOCAL_ID + 2)?.stackChildPrimaryGrow
    ).toBeUndefined();
  });

  it("marks stretched children and hugs content-sized containers", async () => {
    // inline-flex shrink-wraps: both axes hug. Children have no explicit
    // height, so the default `align-items: normal` stretches them.
    const changes = await convertScene(
      `<div style="display:inline-flex;gap:10px;padding:12px">
        <div style="width:50px;height:60px"></div>
        <div style="width:50px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackPrimarySizing: "RESIZE_TO_FIT",
      stackCounterSizing: "RESIZE_TO_FIT",
    });
    const explicit = byLocalId(changes, CONTAINER_LOCAL_ID + 1);
    const stretched = byLocalId(changes, CONTAINER_LOCAL_ID + 2);
    expect(explicit?.stackChildAlignSelf).toBeUndefined();
    expect(stretched?.stackChildAlignSelf).toBe("STRETCH");
  });

  it("hugs the primary axis of an auto-height column", async () => {
    const changes = await convertScene(
      `<div style="width:200px;display:flex;flex-direction:column;gap:8px;padding:10px">
        <div style="width:100px;height:40px"></div>
        <div style="width:100px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackPrimarySizing: "RESIZE_TO_FIT",
      stackCounterSizing: "FIXED",
    });
  });

  it("keeps explicit sizes FIXED on both axes", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;gap:20px">
        <div style="width:100px;height:80px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackPrimarySizing: "FIXED",
      stackCounterSizing: "FIXED",
    });
  });

  it("infers nested stacks independently", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px;height:60px">
          <div style="width:40px;height:40px"></div>
          <div style="width:40px;height:40px"></div>
        </div>
        <div style="height:60px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 10,
    });
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 1)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackSpacing: 8,
    });
  });
});

describe("auto-layout fallbacks (stackMode stays NONE)", () => {
  const expectNone = (changes: ReadonlyArray<FigmaNodeChange>) => {
    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe("NONE");
  };

  it("keeps absolute layout by default (no layout flag)", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;gap:20px">
        <div style="width:100px;height:80px"></div>
        <div style="width:100px;height:80px"></div>
      </div>`,
      "absolute"
    );
    expectNone(changes);
  });

  it("bails when a child's align-self differs from the container", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;align-items:flex-start">
        <div style="width:60px;height:40px"></div>
        <div style="width:60px;height:40px;align-self:flex-end"></div>
      </div>`
    );
    expectNone(changes);
  });

  it("bails on inline children", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px">
        <span style="display:inline-block;width:60px;height:30px"></span>
        <span style="display:inline-block;width:60px;height:30px"></span>
      </div>`
    );
    expectNone(changes);
  });

  it("bails on non-uniform spacing", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex">
        <div style="width:60px;height:40px;margin-right:8px"></div>
        <div style="width:60px;height:40px;margin-right:24px"></div>
        <div style="width:60px;height:40px"></div>
      </div>`
    );
    expectNone(changes);
  });

  it("bails on direct text-node flex items", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;font-family:monospace">
        plain text item
        <div style="width:100px;height:80px"></div>
      </div>`
    );
    expectNone(changes);
  });

  it("bails on non-uniform block margins", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:300px">
        <div style="width:100px;height:40px;margin-bottom:8px"></div>
        <div style="width:100px;height:40px;margin-bottom:32px"></div>
        <div style="width:100px;height:40px"></div>
      </div>`
    );
    expectNone(changes);
  });

  it("bails on floated children", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px">
        <div style="float:left;width:100px;height:80px"></div>
        <div style="float:left;width:100px;height:80px"></div>
      </div>`
    );
    expectNone(changes);
  });
});

describe("block flow inference", () => {
  it("converts uniform block flow into a VERTICAL stack", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:300px;padding:20px;box-sizing:border-box">
        <div style="width:100px;height:40px;margin-bottom:16px"></div>
        <div style="width:100px;height:40px;margin-bottom:16px"></div>
        <div style="width:100px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 16,
      stackPrimaryAlignItems: "MIN",
      stackCounterAlignItems: "MIN",
      stackHorizontalPadding: 20,
      stackVerticalPadding: 20,
      // Vertical paddings are measured, so the fixed container's leftover
      // space (300 - 20 - 3*40 - 2*16 = 128) folds into the trailing pad.
      stackPaddingBottom: 128,
    });
  });

  it("detects margin-auto centering as counter CENTER", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px">
        <div style="width:120px;height:40px;margin:0 auto 12px"></div>
        <div style="width:80px;height:40px;margin:0 auto"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 12,
      stackCounterAlignItems: "CENTER",
    });
  });

  it("marks width-auto block children as STRETCH", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;padding:10px;box-sizing:border-box">
        <div style="height:40px;margin-bottom:10px"></div>
        <div style="width:150px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe("VERTICAL");
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 1)).toMatchObject({
      stackChildAlignSelf: "STRETCH",
    });
    expect(
      byLocalId(changes, CONTAINER_LOCAL_ID + 2)?.stackChildAlignSelf
    ).toBeUndefined();
  });

  it("hugs an auto-height block container", async () => {
    const changes = await convertScene(
      `<div style="width:320px;padding:14px;box-sizing:border-box">
        <div style="width:100px;height:40px;margin-bottom:10px"></div>
        <div style="width:100px;height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackPrimarySizing: "RESIZE_TO_FIT",
      stackCounterSizing: "FIXED",
    });
  });

  it("folds first/last child margins into measured vertical padding", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px">
        <div style="width:100px;height:40px;margin:24px 0"></div>
        <div style="width:100px;height:40px;margin:24px 0 8px"></div>
      </div>`
    );

    // Margins collapse to 24 between children. The first child's top margin
    // collapses THROUGH the unpadded parent (escaping it entirely), so the
    // measured leading pad is 0; the leftover height folds into the trailing
    // pad (200 - 2*40 - 24 = 96).
    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 24,
      stackVerticalPadding: 0,
      stackPaddingBottom: 96,
    });
  });
});

describe("wrap, reverse, and grid", () => {
  it("converts flex-wrap into a wrapped HORIZONTAL stack", async () => {
    // 5 × 90px in a 300px content box → rows of 3 + 2. Content-sized height:
    // align-content stretch would otherwise inflate the measured row gap
    // (which stays geometrically exact, but this pins the simple case).
    const changes = await convertScene(
      `<div style="width:320px;height:110px;display:flex;flex-wrap:wrap;gap:10px;padding:10px;box-sizing:border-box">
        ${'<div style="width:90px;height:40px"></div>'.repeat(5)}
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackWrap: "WRAP",
      stackSpacing: 10,
      stackCounterSpacing: 10,
    });
  });

  it("bails on wrap when row gaps are not uniform", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:220px;display:flex;flex-wrap:wrap;column-gap:10px">
        <div style="width:150px;height:40px;margin-bottom:8px"></div>
        <div style="width:150px;height:40px;margin-bottom:8px"></div>
        <div style="width:150px;height:40px;margin-bottom:30px"></div>
        <div style="width:150px;height:40px;margin-bottom:30px"></div>
        <div style="width:150px;height:40px"></div>
      </div>`
    );
    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe("NONE");
  });

  it("converts row-reverse with reversed emission order", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:80px;display:flex;flex-direction:row-reverse;gap:12px">
        <div style="width:60px;height:40px;background:#ff0000"></div>
        <div style="width:80px;height:40px;background:#00ff00"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackReverseZIndex: true,
      // row-reverse packs from the right: flex-start becomes visual MAX.
      stackPrimaryAlignItems: "MAX",
    });
    // Emission order is visual (left to right): the 80px box (last in DOM,
    // leftmost on screen) must be emitted first.
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 1)?.size?.x).toBe(80);
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 2)?.size?.x).toBe(60);
  });

  it("converts column-reverse into a reversed VERTICAL stack", async () => {
    const changes = await convertScene(
      `<div style="width:200px;height:300px;display:flex;flex-direction:column-reverse;gap:10px">
        <div style="width:100px;height:40px"></div>
        <div style="width:100px;height:60px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackReverseZIndex: true,
      stackPrimaryAlignItems: "MAX",
    });
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 1)?.size?.y).toBe(60);
  });

  it("converts a uniform grid into a wrapped stack", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:130px;display:grid;grid-template-columns:repeat(3, 100px);gap:10px">
        ${'<div style="height:60px"></div>'.repeat(6)}
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "HORIZONTAL",
      stackWrap: "WRAP",
      stackSpacing: 10,
      stackCounterSpacing: 10,
    });
  });

  it("converts a single-column grid like block flow", async () => {
    const changes = await convertScene(
      `<div style="width:200px;height:200px;display:grid;grid-template-columns:1fr;row-gap:14px;align-content:start">
        <div style="height:40px"></div>
        <div style="height:40px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)).toMatchObject({
      stackMode: "VERTICAL",
      stackSpacing: 14,
    });
  });
});

describe("text inside and around stacks", () => {
  it("splits a mid-line wrapping tail into per-line text nodes", async () => {
    // The tail continues the span's line and wraps — the one shape a single
    // Figma text box cannot represent.
    const changes = await convertScene(
      `<div style="width:220px;font-family:'${TEST_FONT_FAMILY}';font-size:24px;line-height:32px">
        <h1 style="margin:0;font-size:24px;line-height:32px">Alpha beta <span style="color:#f60">gamma delta</span> epsilon zeta eta theta</h1>
      </div>`
    );

    const texts = changes.filter((c) => c.type === "TEXT");
    // "Alpha beta ", split span segments, and the split tail segments.
    expect(texts.length).toBeGreaterThanOrEqual(4);
    // The bug's signature was a multi-line union box (h ≈ 2 lines) anchored
    // a line too high; after splitting, every text box is single-line tall.
    for (const text of texts) {
      expect(
        text.size?.y ?? 0,
        `"${text.name}" should be a single-line box`
      ).toBeLessThanOrEqual(34);
    }
  });

  it("anchors centered text glyphs to the emitted box, not the parent", async () => {
    // Centered raw text in a wide parent: the box sits at the measured rect,
    // so baked-in glyph offsets must be near zero — centering against the
    // parent width again would render the glyphs shifted right.
    // Mixed inline content keeps "Alpha" a raw text node with a tight box.
    const changes = await convertScene(
      `<div style="width:600px;height:60px;text-align:center;font-family:'${TEST_FONT_FAMILY}';font-size:24px">
        <h1 style="margin:0;font-size:24px;line-height:32px">Alpha <span style="color:#f60">beta</span></h1>
      </div>`
    );

    const text = changes.find((c) => c.type === "TEXT" && c.name === "Alpha") as
      | (FigmaNodeChange & {
          derivedTextData?: {
            baselines?: Array<{ position?: { x: number } }>;
          };
        })
      | undefined;
    expect(text).toBeDefined();
    const baselineX = text?.derivedTextData?.baselines?.[0]?.position?.x ?? 99;
    expect(Math.abs(baselineX)).toBeLessThan(6);
  });

  it("measures exact (uninflated) text sizes for stack children", () => {
    // Inside stacks the box edges drive sibling positions, so text nodes use
    // getTextSize(node, exact=true) — the raw measured width — instead of the
    // default ceil(width)+1 buffer. Assert both directly against the same
    // measurement so the check is independent of the actual pixel value (which
    // varies per OS font rendering and made an integration-level check flaky).
    const p = document.createElement("p");
    p.style.font = "16px sans-serif";
    p.textContent = "Proportional text";
    document.body.appendChild(p);
    const textNode = p.firstChild as Text;

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const measured = range.getBoundingClientRect().width;

    expect(getTextSize(textNode, true).width).toBe(measured);
    expect(getTextSize(textNode).width).toBe(Math.ceil(measured) + 1);

    p.remove();
  });
});

describe("absolute children inside stacks", () => {
  it("keeps the stack and marks absolute children ABSOLUTE (flex)", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;gap:20px;position:relative">
        <div style="width:100px;height:80px"></div>
        <div style="width:100px;height:80px"></div>
        <div style="position:absolute;top:8px;right:8px;width:24px;height:24px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe(
      "HORIZONTAL"
    );
    // Positioned children sort above static ones, so the badge is emitted
    // last regardless of DOM order.
    const badge = byLocalId(changes, CONTAINER_LOCAL_ID + 3);
    expect(badge).toMatchObject({
      stackPositioning: "ABSOLUTE",
      horizontalConstraint: "MAX",
    });
    expect(
      byLocalId(changes, CONTAINER_LOCAL_ID + 1)?.stackPositioning
    ).toBeUndefined();
  });

  it("keeps the stack and marks absolute children ABSOLUTE (block)", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;position:relative">
        <div style="width:100px;height:40px;margin-bottom:12px"></div>
        <div style="width:100px;height:40px"></div>
        <div style="position:absolute;bottom:4px;left:4px;width:30px;height:10px"></div>
      </div>`
    );

    expect(byLocalId(changes, CONTAINER_LOCAL_ID)?.stackMode).toBe("VERTICAL");
    expect(byLocalId(changes, CONTAINER_LOCAL_ID + 3)).toMatchObject({
      stackPositioning: "ABSOLUTE",
      verticalConstraint: "MAX",
    });
  });
});
