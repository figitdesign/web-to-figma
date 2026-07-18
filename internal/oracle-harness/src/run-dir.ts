import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
/** Run artifacts live under the gitignored `/oracle/` tree. */
const RUNS_ROOT = resolve(REPO_ROOT, "oracle/runs");

export type RunDir = {
  root: string;
  groundTruth: string;
  payloads: string;
  figma: string;
  diff: string;
};

/** Create (recursively) and return the `oracle/runs/<runId>/` layout.
 * `baseRoot` is overridable so tests can target a temp directory. */
export function createRunDir(
  runId: string,
  baseRoot: string = RUNS_ROOT
): RunDir {
  const root = resolve(baseRoot, runId);
  const dir: RunDir = {
    root,
    groundTruth: join(root, "ground-truth"),
    payloads: join(root, "payloads"),
    figma: join(root, "figma"),
    diff: join(root, "diff"),
  };
  for (const path of Object.values(dir)) {
    mkdirSync(path, { recursive: true });
  }
  return dir;
}
