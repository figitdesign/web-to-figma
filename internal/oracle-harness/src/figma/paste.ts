import type { Browser, BrowserContext, Page } from "playwright";
import { extractTopFrameNames } from "./frames";
import type { SessionConfig } from "./session";
import { fileUrl, launchFigmaBrowser, newFigmaContext } from "./session";

// A point on empty canvas to click for focus. The scratch file's page 1 is a
// disposable buffer, so the center is safe to click.
const CANVAS_CENTER = { x: 720, y: 470 };
// tsx transpiles page.evaluate callbacks with esbuild keepNames, which injects
// __name() wrappers absent in the browser. Shim it so those callbacks run.
const NAME_SHIM = "globalThis.__name=globalThis.__name||((f)=>f);";
const EDITOR_SETTLE_MS = 6000;
const SETTLEMENT_TIMEOUT_MS = 180_000;
const SETTLEMENT_POLL_MS = 2000;
const OPEN_TIMEOUT_MS = 60_000;

type FigmaSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

/** Launch, seed the session, open the scratch file, and prepare the page for
 * clipboard operations. */
export async function openFigma(
  config: SessionConfig,
  timeoutMs: number = OPEN_TIMEOUT_MS
): Promise<FigmaSession> {
  const browser = await launchFigmaBrowser();
  const context = await newFigmaContext(browser, config.storageState);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://www.figma.com",
  });
  const page = await context.newPage();
  await page.goto(fileUrl(config.fileKey), {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page.waitForSelector("canvas", { timeout: timeoutMs });
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  await page.addScriptTag({ content: NAME_SHIM });
  return { browser, context, page };
}

async function focusCanvas(page: Page): Promise<void> {
  await page.mouse.click(CANVAS_CENTER.x, CANVAS_CENTER.y);
  await page.waitForTimeout(300);
}

/** Select all and delete — the scratch page is a disposable buffer. */
export async function cleanCanvas(page: Page): Promise<void> {
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(200);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(600);
}

/** Write the kiwi envelope to the clipboard and paste it into the canvas. */
export async function pastePayload(
  page: Page,
  envelope: string
): Promise<void> {
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  }, envelope);
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+v");
}

/** Select all, copy, and read the resulting kiwi payload back off the clipboard
 * — Figma's post-render structure in our own format. */
async function copyBack(page: Page): Promise<string> {
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+c");
  await page.waitForTimeout(1000);
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        return await (await item.getType("text/html")).text();
      }
    }
    return "";
  });
}

/** Select all and "Copy as PNG" (Cmd+Shift+C), returning the rendered image.
 * Figma exports this at a fixed 2× scale. */
export async function copyPng(page: Page): Promise<Buffer> {
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await page.waitForTimeout(1500);
  const base64 = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("image/png")) {
        const bytes = new Uint8Array(
          await (await item.getType("image/png")).arrayBuffer()
        );
        let binary = "";
        for (const b of bytes) {
          binary += String.fromCharCode(b);
        }
        return btoa(binary);
      }
    }
    return "";
  });
  return Buffer.from(base64, "base64");
}

type Settlement = {
  ok: boolean;
  frames: Array<string>;
  capturedHtml: string;
  elapsedMs: number;
};

/** Poll the copy-back until every expected frame has imported (fonts/images
 * settle asynchronously), or the timeout elapses. */
export async function waitForSettlement(
  page: Page,
  expected: ReadonlyArray<string>,
  timeoutMs: number = SETTLEMENT_TIMEOUT_MS
): Promise<Settlement> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let capturedHtml = "";
  let frames: Array<string> = [];
  for (;;) {
    capturedHtml = await copyBack(page);
    frames = extractTopFrameNames(capturedHtml);
    const settled = expected.every((name) => frames.includes(name));
    if (settled) {
      return { ok: true, frames, capturedHtml, elapsedMs: Date.now() - start };
    }
    if (Date.now() > deadline) {
      return { ok: false, frames, capturedHtml, elapsedMs: Date.now() - start };
    }
    await page.waitForTimeout(SETTLEMENT_POLL_MS);
  }
}
