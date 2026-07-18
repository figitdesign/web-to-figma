import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "tsdown";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DOM_TO_FIGMA_ROOT = resolve(REPO_ROOT, "packages/dom-to-figma");
// Mirrors oracle-outbox.ts; the `.oracle-build/` dir is gitignored.
const BUNDLE_PATH = resolve(
  DOM_TO_FIGMA_ROOT,
  "scripts/.oracle-build/figma.iife.js"
);
// Bundle every dependency into the IIFE (matches oracle-outbox.ts).
const BUNDLE_EVERYTHING = /./;

let cached: string | undefined;

/**
 * Build the converter fresh from `@figit/dom-to-figma`'s `src/` as a
 * self-contained IIFE that exposes `window.FigitDomToFigma`, exactly as
 * oracle-outbox.ts does. Cached per process so a batch pays the build once.
 * Always tests source, never the published package.
 */
export async function buildConverterBundle(): Promise<string> {
  if (cached !== undefined) {
    return cached;
  }
  await build({
    cwd: DOM_TO_FIGMA_ROOT,
    entry: { figma: "src/figma.ts" },
    format: ["iife"],
    globalName: "FigitDomToFigma",
    outDir: "scripts/.oracle-build",
    deps: { alwaysBundle: [BUNDLE_EVERYTHING] },
    dts: false,
    clean: true,
    sourcemap: false,
    target: "es2022",
    platform: "browser",
  });
  cached = readFileSync(BUNDLE_PATH, "utf-8");
  return cached;
}
