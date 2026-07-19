import { Buffer } from "node:buffer";
import process from "node:process";
import { chromium } from "playwright";

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

const DEFAULT_TIMEOUT_MS = 60_000;

export type ValidationResult = { ok: boolean; reason?: string };

/** Open the scratch file with the stored session and confirm the editor loads.
 * A logged-in editor renders a `<canvas>`; login/marketing pages do not. */
export async function validateSession(
  config: SessionConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ValidationResult> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: storageStateOption(config.storageState),
    });
    const page = await context.newPage();
    await page.goto(fileUrl(config.fileKey), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    try {
      await page.waitForSelector("canvas", { timeout: timeoutMs });
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: page.url().includes("/login")
          ? "redirected to login (session expired)"
          : "editor canvas did not load within timeout",
      };
    }
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
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
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
