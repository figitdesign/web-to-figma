import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConvertTrace } from "@figit/dom-to-figma";
import { decodeFigmaData, parseClipboardHtml } from "@figit/fig-kiwi";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { buildConverterBundle } from "./bundle";
import type { GroundTruth, GroundTruthElement } from "./ground-truth";
import { TRACKED_STYLES } from "./ground-truth";
import type { Scene } from "./scenes";

// Disable animation/transition/caret and hide scrollbars so the render is
// stable frame-to-frame. Injected after the scene content loads.
const DETERMINISM_CSS =
  "*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important;}html{scrollbar-width:none;}::-webkit-scrollbar{display:none;}";

/** Minimal browser-side view of the converter's IIFE global. */
type ConverterGlobal = {
  createFigmaConverter: (config: { layout: string; trace: boolean }) => {
    convert: (input: {
      element: Element;
      width: number;
      height: number;
      name: string;
    }) => Promise<{ toClipboardHtml: () => string; trace: ConvertTrace }>;
  };
};

export type SnapshotSceneResult = {
  sceneId: string;
  nodeChanges: number;
  traceEntries: number;
  elements: number;
};

export type SnapshotOptions = {
  scenes: ReadonlyArray<Scene>;
  layout: "auto" | "absolute";
  /** Run root; artifacts are written under `ground-truth/` and `payloads/`. */
  outDir: string;
  /** Reuse an existing browser (tests share one); otherwise one is launched. */
  browser?: Browser;
  /** Reuse a pre-built converter bundle; otherwise it is built once. */
  bundle?: string;
};

/** Filesystem-safe stem for a scene id (which may contain `/`). */
function slug(sceneId: string): string {
  return sceneId.replaceAll("/", "__");
}

/** Wait two animation frames so layout and paint have settled. */
function settle(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      })
  );
}

async function convertInPage(
  page: Page,
  scene: Scene,
  layout: "auto" | "absolute"
): Promise<{ envelope: string; trace: ConvertTrace }> {
  return await page.evaluate(
    async ({ width, height, frameName, layoutMode }) => {
      const api = (window as unknown as { FigitDomToFigma: ConverterGlobal })
        .FigitDomToFigma;
      const result = await api
        .createFigmaConverter({ layout: layoutMode, trace: true })
        .convert({ element: document.body, width, height, name: frameName });
      return { envelope: result.toClipboardHtml(), trace: result.trace };
    },
    {
      width: scene.width,
      height: scene.height,
      frameName: scene.name,
      layoutMode: layout,
    }
  );
}

function extractGroundTruth(page: Page): Promise<Array<GroundTruthElement>> {
  return page.evaluate(
    (styleProps: Array<string>) => {
      const out: Array<GroundTruthElement> = [];
      const walk = (element: Element, parentPath: string): void => {
        const parent = element.parentElement;
        const index = parent
          ? Array.from(parent.children).indexOf(element) + 1
          : 1;
        const domPath =
          parentPath === ""
            ? ":scope"
            : `${parentPath} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
        const rect = element.getBoundingClientRect();
        const cs = getComputedStyle(element);
        const styles: Record<string, string> = {};
        for (const prop of styleProps) {
          styles[prop] = cs.getPropertyValue(prop);
        }
        out.push({
          domPath,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          styles,
          visible:
            cs.display !== "none" &&
            cs.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0,
        });
        for (const child of Array.from(element.children)) {
          walk(child, domPath);
        }
      };
      walk(document.body, "");
      return out;
    },
    [...TRACKED_STYLES]
  );
}

function writeArtifacts(options: {
  outDir: string;
  scene: Scene;
  elements: Array<GroundTruthElement>;
  envelope: string;
  trace: ConvertTrace;
  screenshotPath: string;
}): void {
  const { outDir, scene, elements, envelope, trace, screenshotPath } = options;
  const stem = slug(scene.id);
  mkdirSync(resolve(outDir, "ground-truth"), { recursive: true });
  mkdirSync(resolve(outDir, "payloads"), { recursive: true });

  const groundTruth: GroundTruth = {
    sceneId: scene.id,
    width: scene.width,
    height: scene.height,
    dpr: 1,
    screenshotPath,
    elements,
  };
  writeFileSync(
    resolve(outDir, "ground-truth", `${stem}.json`),
    `${JSON.stringify(groundTruth, null, 2)}\n`
  );
  writeFileSync(resolve(outDir, "payloads", `${stem}.html`), envelope);
  writeFileSync(
    resolve(outDir, "payloads", `${stem}.trace.json`),
    `${JSON.stringify(trace, null, 2)}\n`
  );
}

async function snapshotScene(
  scene: Scene,
  layout: "auto" | "absolute",
  outDir: string,
  browser: Browser,
  bundle: string
): Promise<SnapshotSceneResult> {
  const page = await browser.newPage({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(scene.html, { waitUntil: "load" });
    await page.addStyleTag({ content: DETERMINISM_CSS });
    // tsx transpiles `page.evaluate` callbacks with esbuild `keepNames`, which
    // injects `__name(...)` wrappers that don't exist in the browser. Define a
    // no-op so those callbacks run under `tsx` (vitest's transform omits them).
    await page.addScriptTag({
      content: "globalThis.__name=globalThis.__name||((fn)=>fn);",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images).map((img) =>
          img.decode().catch(() => undefined)
        )
      )
    );
    await settle(page);
    await page.addScriptTag({ content: bundle });

    const { envelope, trace } = await convertInPage(page, scene, layout);
    const elements = await extractGroundTruth(page);

    // Fail fast here (not in Figma) if the payload can't round-trip.
    const decoded = decodeFigmaData(parseClipboardHtml(envelope).fig);
    const nodeChanges = decoded.message.nodeChanges as Array<unknown>;

    const stem = slug(scene.id);
    const screenshotPath = `ground-truth/${stem}.png`;
    writeArtifacts({
      outDir,
      scene,
      elements,
      envelope,
      trace,
      screenshotPath,
    });
    await page.screenshot({
      path: resolve(outDir, screenshotPath),
      clip: { x: 0, y: 0, width: scene.width, height: scene.height },
    });

    return {
      sceneId: scene.id,
      nodeChanges: nodeChanges.length,
      traceEntries: trace.entries.length,
      elements: elements.length,
    };
  } finally {
    await page.close();
  }
}

/**
 * Render each scene headlessly, capture ground truth + payload + trace +
 * screenshot into the run dir, and return a per-scene summary. Deterministic:
 * two runs of the same scene produce byte-identical ground truth.
 */
export async function runSnapshot(
  options: SnapshotOptions
): Promise<Array<SnapshotSceneResult>> {
  const bundle = options.bundle ?? (await buildConverterBundle());
  const ownsBrowser = options.browser === undefined;
  const browser = options.browser ?? (await chromium.launch());
  const results: Array<SnapshotSceneResult> = [];
  try {
    for (const scene of options.scenes) {
      results.push(
        await snapshotScene(
          scene,
          options.layout,
          options.outDir,
          browser,
          bundle
        )
      );
    }
  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
  return results;
}
