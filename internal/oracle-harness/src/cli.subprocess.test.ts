import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { afterAll, describe, expect, it } from "vitest";

// Runs the CLI under real `tsx`, not vitest's transform. This is the only path
// that exercises esbuild `keepNames` (the `__name` wrappers in page.evaluate
// callbacks), so it guards a bug class the in-process integration test misses.
// Launches Chromium; gated behind ORACLE_BROWSER=1 like the other browser tests.
const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const RUN_ID = "test-tsx-cli";
const RUN_DIR = resolve(PACKAGE_ROOT, "../../oracle/runs", RUN_ID);
const SUBPROCESS_TIMEOUT = 120_000;

describe.skipIf(process.env.ORACLE_BROWSER !== "1")("cli under tsx", () => {
  afterAll(() => {
    rmSync(RUN_DIR, { recursive: true, force: true });
  });

  it(
    "runs snapshot end-to-end with no transform/__name errors",
    () => {
      rmSync(RUN_DIR, { recursive: true, force: true });
      // Throws (failing the test) on a non-zero exit, surfacing stderr.
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "src/cli.ts",
          "snapshot",
          "--scene",
          "00-smoke/two-boxes",
          "--run-id",
          RUN_ID,
        ],
        { cwd: PACKAGE_ROOT, stdio: "pipe" }
      );
      expect(
        existsSync(resolve(RUN_DIR, "ground-truth", "00-smoke__two-boxes.png"))
      ).toBe(true);
    },
    SUBPROCESS_TIMEOUT
  );
});
