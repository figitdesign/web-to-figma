import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

// internal/oracle-harness/src → repo root
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const ORACLE_SCENES_DIR = resolve(
  REPO_ROOT,
  "packages/dom-to-figma/scripts/oracle-scenes"
);

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
// Matches the size-hint comment convention used by oracle-outbox.ts.
const SIZE_HINT = /<!--\s*oracle:\s*width=(\d+)\s+height=(\d+)\s*-->/;
const HTML_EXT = /\.html$/;

export type Scene = {
  /** Stable id relative to the scenes dir, without extension, e.g. `01-flex/row-gap`. */
  id: string;
  /** Title-cased frame name shown in Figma. */
  name: string;
  /** Absolute path to the source HTML file. */
  path: string;
  html: string;
  width: number;
  height: number;
};

function titleFromId(id: string): string {
  return basename(id)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function collectHtmlFiles(dir: string, acc: Array<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtmlFiles(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      acc.push(abs);
    }
  }
}

function loadScene(path: string): Scene {
  const html = readFileSync(path, "utf-8");
  const id = relative(ORACLE_SCENES_DIR, path)
    .replace(HTML_EXT, "")
    .split(sep)
    .join("/");
  const hint = SIZE_HINT.exec(html);
  return {
    id,
    name: titleFromId(id),
    path,
    html,
    width: hint ? Number(hint[1]) : DEFAULT_WIDTH,
    height: hint ? Number(hint[2]) : DEFAULT_HEIGHT,
  };
}

/** Every committed oracle scene, sorted by id for stable manifests. */
export function discoverScenes(): Array<Scene> {
  const files: Array<string> = [];
  collectHtmlFiles(ORACLE_SCENES_DIR, files);
  return files.map(loadScene).sort((a, b) => a.id.localeCompare(b.id));
}
