import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createRunDir } from "./run-dir";

describe("createRunDir()", () => {
  const base = mkdtempSync(join(tmpdir(), "oracle-runs-"));

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the full run directory layout", () => {
    const dir = createRunDir("20260718-abc123", base);
    for (const path of [
      dir.root,
      dir.groundTruth,
      dir.payloads,
      dir.figma,
      dir.diff,
    ]) {
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });
});
