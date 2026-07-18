import { afterEach, describe, expect, it } from "vitest";
import type { TraceEntry } from "./converter/trace";
import type { FigmaGuid } from "./converter/types";
import { createFigmaConverter } from "./figma";

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;
const RECT_TOLERANCE_PX = 0.1;

const mountElement = (html: string): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as HTMLElement;
};

const guidKey = (guid: FigmaGuid): string =>
  `${guid.sessionID}:${guid.localID}`;

/** Resolve a trace domPath (minus any `::text[i]` suffix) to its element. */
const resolveEntry = (root: Element, domPath: string): Element | null => {
  const selector = domPath.split("::text[")[0] as string;
  if (selector === ":scope") {
    return root;
  }
  return root.querySelector(selector);
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createFigmaConverter trace mode", () => {
  it("returns no trace unless enabled", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px"></div>`
    );
    const result = await createFigmaConverter().convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });
    expect(result.trace).toBeUndefined();
  });

  it("maps every traced guid to a payload node and resolves its element", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;padding:8px;background:#fff">
        <div style="background:#eee;padding:4px">Alpha</div>
        <div style="background:#ddd;padding:4px"><p style="margin:0">Beta</p></div>
      </div>`
    );
    const result = await createFigmaConverter({ trace: true }).convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const trace = result.trace;
    expect(trace).toBeDefined();
    if (!trace) {
      return;
    }
    expect(trace.entries.length).toBeGreaterThan(0);

    const payloadGuids = new Set(
      result.document.nodeChanges.map((change) => guidKey(change.guid))
    );
    for (const entry of trace.entries) {
      expect(payloadGuids.has(guidKey(entry.guid))).toBe(true);
      expect(resolveEntry(element, entry.domPath)).not.toBeNull();
    }
  });

  it("matches element rects to getBoundingClientRect", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;padding:8px;background:#fff">
        <div style="width:120px;height:60px;background:#f00"></div>
      </div>`
    );
    const result = await createFigmaConverter({ trace: true }).convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    for (const entry of result.trace?.entries ?? []) {
      if (entry.tag === "#text") {
        continue;
      }
      const resolved = resolveEntry(element, entry.domPath) as HTMLElement;
      const rect = resolved.getBoundingClientRect();
      expect(Math.abs(entry.rect.x - rect.x)).toBeLessThan(RECT_TOLERANCE_PX);
      expect(Math.abs(entry.rect.y - rect.y)).toBeLessThan(RECT_TOLERANCE_PX);
      expect(Math.abs(entry.rect.width - rect.width)).toBeLessThan(
        RECT_TOLERANCE_PX
      );
      expect(Math.abs(entry.rect.height - rect.height)).toBeLessThan(
        RECT_TOLERANCE_PX
      );
    }
  });

  it("builds nth-child dom paths from real DOM position", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;padding:8px;background:#fff">
        <div style="background:#eee;padding:4px">Alpha</div>
        <div style="background:#ddd;padding:4px"><p style="margin:0">Beta</p></div>
      </div>`
    );
    const result = await createFigmaConverter({ trace: true }).convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const paragraph = result.trace?.entries.find((e) => e.tag === "p");
    expect(paragraph?.domPath).toBe(
      ":scope > div:nth-child(2) > p:nth-child(1)"
    );
  });

  it("does not change payload bytes when tracing", async () => {
    const html = `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;padding:8px;background:#fff"><div style="width:50px;height:50px;background:#f00"></div></div>`;
    const traced = await createFigmaConverter({ trace: true }).convert({
      element: mountElement(html),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });
    const plain = await createFigmaConverter().convert({
      element: mountElement(html),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });
    expect(traced.base64).toBe(plain.base64);
  });

  it("shares one dom path across a wrapped text node's line segments", async () => {
    const element = mountElement(
      `<div style="width:60px;font:16px/1 monospace;padding:0;background:#fff"><span>xx</span>yyyy zzzz wwww qqqq rrrr</div>`
    );
    const result = await createFigmaConverter({ trace: true }).convert({
      element,
      width: 60,
      height: FRAME_HEIGHT,
    });

    const byPath = new Map<string, Array<TraceEntry>>();
    for (const entry of result.trace?.entries ?? []) {
      if (entry.tag !== "#text") {
        continue;
      }
      const group = byPath.get(entry.domPath) ?? [];
      group.push(entry);
      byPath.set(entry.domPath, group);
    }

    const segments = [...byPath.values()].find((group) => group.length > 1);
    expect(segments).toBeDefined();
    const guids = new Set((segments ?? []).map((e) => guidKey(e.guid)));
    expect(guids.size).toBe(segments?.length);
  });

  it("traces a form element even though it emits a synthesized child", async () => {
    const element = mountElement(
      `<div style="width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px">
        <input placeholder="Email" style="width:200px;height:40px;border:1px solid #ccc" />
      </div>`
    );
    const result = await createFigmaConverter({ trace: true }).convert({
      element,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });

    const input = result.trace?.entries.find((e) => e.tag === "input");
    expect(input?.kind).toBe("form-with-placeholder");
    // The placeholder child node exists in the payload but is attributed to
    // the input via tree ancestry, not its own trace entry.
    expect(result.document.nodeChanges.length).toBeGreaterThan(
      result.trace?.entries.length ?? 0
    );
  });
});
