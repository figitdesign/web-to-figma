import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTestFontLoader,
  loadTestFontIntoBrowser,
} from "./__fixtures__/loaders";
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

  it("bails on absolutely positioned children (phase 3)", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px;display:flex;position:relative">
        <div style="width:100px;height:80px"></div>
        <div style="position:absolute;top:0;right:0;width:20px;height:20px"></div>
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

  it("bails on flex-wrap (phase 4)", async () => {
    const changes = await convertScene(
      `<div style="width:150px;height:200px;display:flex;flex-wrap:wrap">
        <div style="width:100px;height:40px"></div>
        <div style="width:100px;height:40px"></div>
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

  it("bails on non-flex containers", async () => {
    const changes = await convertScene(
      `<div style="width:320px;height:200px">
        <div style="width:100px;height:80px"></div>
      </div>`
    );
    expectNone(changes);
  });
});
