import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

// Repo-root .env (gitignored). tsx doesn't auto-load it, so the harness does.
const ENV_PATH = resolve(import.meta.dirname, "../../..", ".env");
const ENV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
const QUOTED = /^["'](.*)["']$/;

/**
 * process.env with the repo-root `.env` overlaid for keys not already set
 * (real environment variables win). Minimal, dependency-free.
 */
export function loadEnv(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env };
  if (!existsSync(ENV_PATH)) {
    return merged;
  }
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const match = ENV_LINE.exec(line);
    const key = match?.[1];
    if (key && merged[key] === undefined) {
      merged[key] = (match?.[2] ?? "").replace(QUOTED, "$1");
    }
  }
  return merged;
}
