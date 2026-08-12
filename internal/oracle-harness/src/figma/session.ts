import { Buffer } from "node:buffer";
import process from "node:process";
import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright";

// figma.com's CloudFront WAF 403s the default headless fingerprint. A realistic
// user-agent plus disabling the automation flag gets the editor to load. Every
// Figma browser context in the harness must go through the factories below.
const FIGMA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];
const VIEWPORT = { width: 1440, height: 900 };

export function launchFigmaBrowser(headless = true): Promise<Browser> {
  return chromium.launch({ headless, args: LAUNCH_ARGS });
}

export type ResolvedStorageState =
  | { kind: "path"; path: string }
  | { kind: "inline"; state: Record<string, unknown> };

export type SessionConfig = {
  storageState: ResolvedStorageState;
  fileKey: string;
  /** Optional — only used by the WS-2.5 REST pixel fallback. */
  token?: string;
};

export type ConfigResolution =
  | { ok: true; config: SessionConfig }
  | { ok: false; errors: Array<string> };

const BASE64_ONLY = /^[A-Za-z0-9+/=\r\n]+$/;

/** Classify `FIGMA_STORAGE_STATE`: inline JSON, base64-of-JSON (CI secret), or
 * a filesystem path Playwright reads directly. A base64 value only counts if it
 * decodes to something starting with `{`, so real paths never misclassify. */
export function classifyStorageState(
  raw: string
): ResolvedStorageState | { error: string } {
  const value = raw.trim();
  if (value.startsWith("{")) {
    try {
      return { kind: "inline", state: JSON.parse(value) };
    } catch {
      return { error: "FIGMA_STORAGE_STATE looks like JSON but did not parse" };
    }
  }
  if (BASE64_ONLY.test(value)) {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf-8");
      if (decoded.startsWith("{")) {
        return { kind: "inline", state: JSON.parse(decoded) };
      }
    } catch {
      // fall through to path
    }
  }
  return { kind: "path", path: value };
}

/** Resolve session config from an env map. Pure; no filesystem or network. */
export function resolveSessionConfig(
  env: Record<string, string | undefined>
): ConfigResolution {
  const errors: Array<string> = [];
  const rawState = env.FIGMA_STORAGE_STATE?.trim();
  const fileKey = env.FIGMA_FILE_KEY?.trim();
  const token = env.FIGMA_TOKEN?.trim() || undefined;

  let storageState: ResolvedStorageState | undefined;
  if (rawState) {
    const classified = classifyStorageState(rawState);
    if ("error" in classified) {
      errors.push(classified.error);
    } else {
      storageState = classified;
    }
  } else {
    errors.push(
      "FIGMA_STORAGE_STATE is required — run `figma login` to create it"
    );
  }
  if (!fileKey) {
    errors.push(
      "FIGMA_FILE_KEY is required — the scratch file's key from its URL"
    );
  }

  if (!(storageState && fileKey)) {
    return { ok: false, errors };
  }
  return { ok: true, config: { storageState, fileKey, token } };
}

export function fileUrl(fileKey: string): string {
  return `https://www.figma.com/design/${fileKey}`;
}

type StorageStateOption = string | { cookies: []; origins: [] };

function storageStateOption(state: ResolvedStorageState): StorageStateOption {
  return state.kind === "path"
    ? state.path
    : (state.state as unknown as { cookies: []; origins: [] });
}

/** Create a Figma-ready context: anti-detection UA + viewport, optionally
 * seeded with a saved session. Shared by validate, paste, and capture. */
export function newFigmaContext(
  browser: Browser,
  storageState?: ResolvedStorageState
): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: FIGMA_USER_AGENT,
    viewport: VIEWPORT,
    ...(storageState ? { storageState: storageStateOption(storageState) } : {}),
  });
}

const DEFAULT_TIMEOUT_MS = 60_000;
// The anonymous banner mounts after the canvas, so sampling the text the
// instant a canvas appears reads an editor that isn't there yet.
const VIEWER_SETTLE_MS = 6000;

export type ValidationResult = { ok: boolean; reason?: string };

/**
 * Whether Figma served the signed-out viewer rather than the editor.
 *
 * A `<canvas>` proves nothing on its own: the scratch file is publicly
 * viewable, so an expired session still renders one and the old canvas-only
 * check passed. That is not a cosmetic gap — with no edit rights `pastePayload`
 * and `copyBack` both become no-ops, so tier-1 reads back the payload it just
 * wrote to the clipboard and reports zero findings. A dead session therefore
 * looked like perfect parity instead of an error.
 */
export function isAnonymousViewer(pageText: string): boolean {
  return (
    /sign up to comment/i.test(pageText) ||
    /(^|\W)view only(\W|$)/i.test(pageText)
  );
}

/** Open the scratch file with the stored session and confirm an *editable*
 * editor loads — a canvas plus the absence of the signed-out viewer. */
export async function validateSession(
  config: SessionConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ValidationResult> {
  const browser = await launchFigmaBrowser();
  try {
    const context = await newFigmaContext(browser, config.storageState);
    const page = await context.newPage();
    await page.goto(fileUrl(config.fileKey), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    try {
      await page.waitForSelector("canvas", { timeout: timeoutMs });
    } catch {
      return {
        ok: false,
        reason: page.url().includes("/login")
          ? "redirected to login (session expired)"
          : "editor canvas did not load within timeout",
      };
    }
    await page.waitForTimeout(VIEWER_SETTLE_MS);
    const pageText = await page.evaluate(() => document.body.innerText ?? "");
    if (isAnonymousViewer(pageText)) {
      return {
        ok: false,
        reason:
          "signed out — Figma served the anonymous viewer, not the editor; re-run `cli figma login`",
      };
    }
    return { ok: true };
  } finally {
    await browser.close();
  }
}

function waitForEnter(): Promise<void> {
  return new Promise((res) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      res();
    });
  });
}

/** Headed interactive login: the human signs in once, then the session is
 * saved to `statePath`. Local-only (needs a display and stdin). */
export async function saveLoginSession(statePath: string): Promise<void> {
  const browser = await launchFigmaBrowser(false);
  try {
    const context = await newFigmaContext(browser);
    const page = await context.newPage();
    await page.goto("https://www.figma.com/login");
    process.stdout.write(
      "\nA browser window opened. Sign in to Figma, then press Enter here to save the session...\n"
    );
    await waitForEnter();
    await context.storageState({ path: statePath });
    process.stdout.write(`Saved Figma session → ${statePath}\n`);
  } finally {
    await browser.close();
  }
}
