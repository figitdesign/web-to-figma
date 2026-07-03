/**
 * Generate an oracle outbox batch: convert scenes headlessly and emit
 * self-contained copy-button pages plus an INSTRUCTIONS.md, for the
 * human-in-the-loop auto-layout verification workflow
 * (see .context/auto-layout/PLAN.md).
 *
 * Usage:
 *   pnpm oracle:outbox <batch-name> <scene>...
 *
 * where <scene> is either a path to an HTML file or `corpus:<slug>` for a
 * playground corpus scene, e.g.:
 *   pnpm oracle:outbox batch-00-smoke scripts/oracle-scenes/00-smoke/two-boxes.html
 *   pnpm oracle:outbox batch-01-flex corpus:layout/flex
 *
 * Scenes render at 1280x800 unless they carry a size hint comment:
 *   <!-- oracle: width=320 height=200 -->
 *
 * Each page is converted with the real library (bundled fresh from src/ on
 * every run), and the resulting envelope is decoded again before writing, so
 * a broken payload fails here instead of in Figma.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { decodeFigmaData, parseClipboardHtml } from "@figit/fig-kiwi";
import { chromium } from "playwright";
import { build } from "tsdown";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const CORPUS_DIR = resolve(REPO_ROOT, "apps/playground/src/corpus");
const OUTBOX = resolve(REPO_ROOT, "oracle/outbox");
const BUNDLE_PATH = resolve(
  PACKAGE_ROOT,
  "scripts/.oracle-build/figma.iife.js"
);

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const SIZE_HINT = /<!--\s*oracle:\s*width=(\d+)\s+height=(\d+)\s*-->/;

type SceneSpec = {
  /** kebab-case identifier, used in file and capture names. */
  id: string;
  /** Frame name shown in Figma. */
  name: string;
  html: string;
  width: number;
  height: number;
};

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadScene(ref: string): SceneSpec {
  const path = ref.startsWith("corpus:")
    ? resolve(CORPUS_DIR, `${ref.slice("corpus:".length)}.html`)
    : resolve(PACKAGE_ROOT, ref);
  const id = ref.startsWith("corpus:")
    ? ref.slice("corpus:".length).replace("/", "-")
    : basename(path, ".html");

  const html = readFileSync(path, "utf-8");
  const hint = SIZE_HINT.exec(html);
  return {
    id,
    name: titleFromId(id),
    html,
    width: hint ? Number(hint[1]) : DEFAULT_WIDTH,
    height: hint ? Number(hint[2]) : DEFAULT_HEIGHT,
  };
}

/** Escape a string for safe embedding inside a <script> tag. */
function scriptSafeJson(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function copyPageHtml(options: {
  batch: string;
  captureName: string;
  scene: SceneSpec;
  envelope: string;
  nodeCount: number;
}): string {
  const { batch, captureName, scene, envelope, nodeCount } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${batch} / ${scene.id}</title>
<style>
  body { margin: 0; padding: 32px; font-family: system-ui, sans-serif; background: #fafafa; color: #18181b; }
  main { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  h1 { font-size: 16px; margin: 0; }
  h1 small { color: #71717a; font-weight: 400; }
  button { font-size: 15px; font-weight: 600; padding: 12px 20px; border-radius: 8px; border: none; background: #18181b; color: white; cursor: pointer; align-self: flex-start; }
  button:hover { background: #3f3f46; }
  ol { margin: 0; padding-left: 20px; line-height: 1.7; font-size: 14px; }
  code { background: #e4e4e7; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; }
  #status { font-size: 14px; min-height: 20px; color: #16a34a; font-weight: 600; }
  iframe { border: 1px solid #e4e4e7; border-radius: 8px; background: white; }
  .meta { font-size: 12px; color: #71717a; }
</style>
</head>
<body>
<main>
  <h1>${batch} / ${scene.id} <small>(${nodeCount} node changes)</small></h1>
  <button id="copy" type="button">1. Copy Figma payload</button>
  <p id="status"></p>
  <ol>
    <li>Click the button above (use Chrome if copying fails).</li>
    <li>In the scratch Figma file: <strong>Cmd+V</strong>. Compare against the preview below.</li>
    <li>Select the pasted top-level frame, <strong>Cmd+C</strong>.</li>
    <li>Run: <code>pnpm oracle:capture ${captureName}</code></li>
  </ol>
  <p class="meta">Preview (what the paste should look like, ${scene.width}×${scene.height}):</p>
  <iframe title="scene preview" width="${scene.width}" height="${scene.height}" srcdoc="${escapeAttribute(scene.html)}"></iframe>
</main>
<script>
  const ENVELOPE = ${scriptSafeJson(envelope)};
  const status = document.getElementById("status");
  document.getElementById("copy").addEventListener("click", async () => {
    try {
      const blob = new Blob([ENVELOPE], { type: "text/html" });
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]);
      status.textContent = "Copied ✓ — now paste in Figma (Cmd+V)";
    } catch (error) {
      status.style.color = "#dc2626";
      status.textContent = "Copy failed: " + error.message + " — try Chrome, and click the page first.";
    }
  });
</script>
</body>
</html>
`;
}

/** Horizontal gutter between scene frames on the Figma canvas. */
const CANVAS_GUTTER = 80;

function singlePageHtml(options: {
  batch: string;
  captureName: string;
  scenes: ReadonlyArray<SceneSpec>;
  envelope: string;
  nodeCount: number;
}): string {
  const { batch, captureName, scenes, envelope, nodeCount } = options;
  const previews = scenes
    .map(
      (scene) =>
        `<p class="meta">${scene.name} (${scene.width}×${scene.height})</p>
  <iframe title="${scene.name}" width="${scene.width}" height="${scene.height}" srcdoc="${escapeAttribute(scene.html)}"></iframe>`
    )
    .join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${batch} / all scenes</title>
<style>
  body { margin: 0; padding: 32px; font-family: system-ui, sans-serif; background: #fafafa; color: #18181b; }
  main { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  h1 { font-size: 16px; margin: 0; }
  h1 small { color: #71717a; font-weight: 400; }
  button { font-size: 15px; font-weight: 600; padding: 12px 20px; border-radius: 8px; border: none; background: #18181b; color: white; cursor: pointer; align-self: flex-start; }
  button:hover { background: #3f3f46; }
  ol { margin: 0; padding-left: 20px; line-height: 1.7; font-size: 14px; }
  code { background: #e4e4e7; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; }
  #status { font-size: 14px; min-height: 20px; color: #16a34a; font-weight: 600; }
  iframe { border: 1px solid #e4e4e7; border-radius: 8px; background: white; }
  .meta { font-size: 12px; color: #71717a; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>${batch} — all ${scenes.length} scenes in one paste <small>(${nodeCount} node changes)</small></h1>
  <button id="copy" type="button">1. Copy Figma payload (all scenes)</button>
  <p id="status"></p>
  <ol>
    <li>Click the button above (use Chrome if copying fails).</li>
    <li>In the scratch Figma file: <strong>Cmd+V</strong> once — all ${scenes.length} frames appear side by side.</li>
    <li>Select <strong>all ${scenes.length} pasted frames</strong> (drag a rubber-band around them on the canvas), then <strong>Cmd+C</strong>.</li>
    <li>Run: <code>pnpm oracle:capture ${captureName}</code></li>
  </ol>
  ${previews}
</main>
<script>
  const ENVELOPE = ${scriptSafeJson(envelope)};
  const status = document.getElementById("status");
  document.getElementById("copy").addEventListener("click", async () => {
    try {
      const blob = new Blob([ENVELOPE], { type: "text/html" });
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]);
      status.textContent = "Copied ✓ — now paste in Figma (Cmd+V)";
    } catch (error) {
      status.style.color = "#dc2626";
      status.textContent = "Copy failed: " + error.message + " — try Chrome, and click the page first.";
    }
  });
</script>
</body>
</html>
`;
}

function singleInstructionsMarkdown(
  batch: string,
  captureName: string
): string {
  return `# ${batch} (single-paste batch)

All scenes travel in one payload.

1. Open \`oracle/outbox/${batch}/all-scenes.html\` in Chrome, click **Copy**.
2. In a scratch Figma design file: **Cmd+V** once.
3. Rubber-band select all pasted frames, **Cmd+C**.
4. Run \`pnpm oracle:capture ${captureName}\`, then ping Claude.
`;
}

function instructionsMarkdown(
  batch: string,
  entries: Array<{ file: string; captureName: string; scene: SceneSpec }>
): string {
  const steps = entries
    .map(
      (e, i) =>
        `${i + 1}. Open \`oracle/outbox/${batch}/${e.file}\` in Chrome and follow the four steps on the page.\n` +
        `   Capture command: \`pnpm oracle:capture ${e.captureName}\``
    )
    .join("\n");
  return `# ${batch}

One scene = one HTML page = one capture. Each page has the payload baked in
and lists its own steps; this file is just the batch checklist.

Setup (once): open a scratch Figma design file. Any file works; nothing is
read from your account.

${steps}

When every capture is in \`oracle/inbox/${batch}/\`, ping Claude.
`;
}

/**
 * Single-paste mode: mount every scene in its own iframe (so scene CSS can't
 * collide), convert them all as one multi-frame canvas payload, and emit one
 * copy page — one paste, one selection, one capture for the whole batch.
 */
async function generateSinglePage(options: {
  batch: string;
  batchDir: string;
  scenes: Array<SceneSpec>;
  bundle: string;
  layout: string;
  browser: Awaited<ReturnType<typeof chromium.launch>>;
}) {
  const { batch, batchDir, scenes, bundle, layout, browser } = options;

  const compositeHtml = `<!DOCTYPE html><html><body style="margin:0">
${scenes
  .map(
    (scene) =>
      `<iframe width="${scene.width}" height="${scene.height}" style="border:0;display:block" srcdoc="${escapeAttribute(scene.html)}"></iframe>`
  )
  .join("\n")}
</body></html>`;

  const maxWidth = Math.max(...scenes.map((s) => s.width));
  const totalHeight = scenes.reduce((n, s) => n + s.height, 0);
  const page = await browser.newPage({
    viewport: { width: maxWidth, height: totalHeight },
  });
  await page.setContent(compositeHtml, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    await Promise.all(frames.map((f) => f.contentDocument?.fonts.ready));
  });
  await page.addScriptTag({ content: bundle });

  // Pages can be taller than their viewport hint; the template frame must
  // cover the full scroll height or the paste clips everything below the
  // fold (the frame masks its children, mirroring browser overflow). The
  // iframe keeps the hint-sized viewport so vh/fixed styling still renders
  // like a real browser window.
  const contentHeights = await page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe")).map((frame) =>
      Math.ceil(frame.contentDocument?.documentElement.scrollHeight ?? 0)
    )
  );
  for (const [i, scene] of scenes.entries()) {
    scene.height = Math.max(scene.height, contentHeights[i] ?? 0);
  }

  const frameInputs: Array<{
    width: number;
    height: number;
    x: number;
    y: number;
    name: string;
  }> = [];
  let x = 0;
  for (const scene of scenes) {
    frameInputs.push({
      width: scene.width,
      height: scene.height,
      x,
      y: 0,
      name: scene.name,
    });
    x += scene.width + CANVAS_GUTTER;
  }

  const envelope = await page.evaluate(
    async ({ inputs, layoutMode, canvasName }) => {
      const api = (
        window as unknown as {
          FigitDomToFigma: {
            createFigmaConverter: (config: { layout: string }) => {
              convert: (input: {
                frames: Array<Record<string, unknown>>;
                canvasName: string;
              }) => Promise<{ toClipboardHtml: () => string }>;
            };
          };
        }
      ).FigitDomToFigma;
      const iframes = Array.from(document.querySelectorAll("iframe"));
      const frames = inputs.map((input, i) => ({
        ...input,
        element: iframes[i]?.contentDocument?.body as Element,
      }));
      const result = await api
        .createFigmaConverter({ layout: layoutMode })
        .convert({ frames, canvasName });
      return result.toClipboardHtml();
    },
    { inputs: frameInputs, layoutMode: layout, canvasName: batch }
  );
  await page.close();

  const decoded = decodeFigmaData(parseClipboardHtml(envelope).fig);
  const nodeChanges = decoded.message.nodeChanges as Array<
    Record<string, unknown>
  >;
  const topFrames = nodeChanges.filter(
    (c) =>
      c.type === "FRAME" &&
      (c.parentIndex as { guid: { localID: number } } | undefined)?.guid
        .localID === 1
  );
  if (topFrames.length !== scenes.length) {
    throw new Error(
      `Expected ${scenes.length} top-level frames, payload has ${topFrames.length}.`
    );
  }

  const captureName = `${batch}/all-scenes`;
  writeFileSync(
    resolve(batchDir, "all-scenes.html"),
    singlePageHtml({
      batch,
      captureName,
      scenes,
      envelope,
      nodeCount: nodeChanges.length,
    })
  );
  writeFileSync(
    resolve(batchDir, "INSTRUCTIONS.md"),
    singleInstructionsMarkdown(batch, captureName)
  );
  console.error(
    `all-scenes.html  (${scenes.length} scenes, ${nodeChanges.length} node changes)`
  );
  console.error(`\nBatch ready: oracle/outbox/${batch}/ (single-paste mode)`);
}

async function main() {
  const args = process.argv.slice(2);
  const layout = args.includes("--layout=auto") ? "auto" : "absolute";
  const single = args.includes("--single");
  const [batch, ...sceneRefs] = args.filter((a) => !a.startsWith("--"));
  if (!batch || sceneRefs.length === 0) {
    console.error(
      "Usage: pnpm oracle:outbox [--layout=auto] [--single] <batch-name> <scene>..."
    );
    process.exit(1);
  }

  console.error("Bundling converter from src/ ...");
  // Self-contained IIFE bundle of the converter, injected into each headless
  // page below. Never published.
  await build({
    cwd: PACKAGE_ROOT,
    entry: { figma: "src/figma.ts" },
    format: ["iife"],
    globalName: "FigitDomToFigma",
    outDir: "scripts/.oracle-build",
    deps: { alwaysBundle: [/./] },
    dts: false,
    clean: true,
    sourcemap: false,
    target: "es2022",
    platform: "browser",
  });
  const bundle = readFileSync(BUNDLE_PATH, "utf-8");

  const scenes = sceneRefs.map(loadScene);
  const batchDir = resolve(OUTBOX, batch);
  mkdirSync(batchDir, { recursive: true });

  const browser = await chromium.launch();

  if (single) {
    try {
      await generateSinglePage({
        batch,
        batchDir,
        scenes,
        bundle,
        layout,
        browser,
      });
    } finally {
      await browser.close();
    }
    return;
  }
  const entries: Array<{
    file: string;
    captureName: string;
    scene: SceneSpec;
  }> = [];
  try {
    for (const [index, scene] of scenes.entries()) {
      const page = await browser.newPage({
        viewport: { width: scene.width, height: scene.height },
      });
      await page.setContent(scene.html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: bundle });

      // Cover the full scroll height so the paste doesn't clip below-the-fold
      // content (see the single-page path for details).
      scene.height = Math.max(
        scene.height,
        await page.evaluate(() =>
          Math.ceil(document.documentElement.scrollHeight)
        )
      );

      const envelope = await page.evaluate(
        async ({ width, height, name, layoutMode }) => {
          const api = (
            window as unknown as {
              FigitDomToFigma: {
                createFigmaConverter: (config: { layout: string }) => {
                  convert: (input: {
                    element: Element;
                    width: number;
                    height: number;
                    name: string;
                  }) => Promise<{ toClipboardHtml: () => string }>;
                };
              };
            }
          ).FigitDomToFigma;
          const result = await api
            .createFigmaConverter({ layout: layoutMode })
            .convert({ element: document.body, width, height, name });
          return result.toClipboardHtml();
        },
        {
          width: scene.width,
          height: scene.height,
          name: scene.name,
          layoutMode: layout,
        }
      );
      await page.close();

      // Round-trip the envelope through the decoder before writing anything.
      const decoded = decodeFigmaData(parseClipboardHtml(envelope).fig);
      const nodeChanges = decoded.message.nodeChanges;
      const nodeCount = Array.isArray(nodeChanges) ? nodeChanges.length : 0;
      if (nodeCount < 3) {
        throw new Error(
          `Scene '${scene.id}' produced only ${nodeCount} node changes — conversion likely failed.`
        );
      }

      const prefix = String(index + 1).padStart(2, "0");
      const file = `${prefix}-${scene.id}.html`;
      const captureName = `${batch}/${prefix}-${scene.id}`;
      writeFileSync(
        resolve(batchDir, file),
        copyPageHtml({ batch, captureName, scene, envelope, nodeCount })
      );
      entries.push({ file, captureName, scene });
      console.error(
        `${file}  (${scene.width}x${scene.height}, ${nodeCount} node changes)`
      );
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    resolve(batchDir, "INSTRUCTIONS.md"),
    instructionsMarkdown(batch, entries)
  );
  console.error(
    `\nBatch ready: oracle/outbox/${batch}/ (INSTRUCTIONS.md inside)`
  );
}

await main();
