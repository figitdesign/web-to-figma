import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { LedgerEntry } from "./ledger";
import {
  readLedger,
  readRunCounter,
  writeLedger,
  writeRunCounter,
} from "./ledger-io";

function entry(cls: string, status: LedgerEntry["status"]): LedgerEntry {
  return {
    class: cls,
    status,
    severity: 0.5,
    firstSeenRun: "r1",
    lastSeenRun: "r1",
    lastAttemptRun: null,
    attempts: 0,
    cooldownUntilRun: null,
    exemplarScene: "s1",
    exemplarFindingId: "abc123def456",
    tier: 0,
    issue: null,
    body: "## Analysis\n\n## Attempts\n\n## Verdict\n",
  };
}

describe("ledger-io", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips entries and deletes resolved files", () => {
    const entries = new Map([
      ["geometry.x", entry("geometry.x", "open")],
      ["text.lineHeight", entry("text.lineHeight", "parked")],
    ]);
    writeLedger(entries, [], dir);

    const read = readLedger(dir);
    expect([...read.keys()].sort()).toEqual(["geometry.x", "text.lineHeight"]);
    expect(read.get("text.lineHeight")?.status).toBe("parked");

    // Resolving removes just that file.
    writeLedger(read, ["geometry.x"], dir);
    expect(existsSync(resolve(dir, "geometry.x.md"))).toBe(false);
    expect(existsSync(resolve(dir, "text.lineHeight.md"))).toBe(true);
  });

  it("reads a missing counter as 0 and round-trips a value", () => {
    expect(readRunCounter(dir)).toBe(0);
    writeRunCounter(7, dir);
    expect(readRunCounter(dir)).toBe(7);
  });
});
