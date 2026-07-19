import { describe, expect, it } from "vitest";
import { run } from "./cli";

const SUBCOMMANDS = [
  "snapshot",
  "figma",
  "report",
  "check",
  "ledger",
  "calibrate",
  "guard",
  "history",
];

describe("cli run()", () => {
  it("prints help listing every subcommand and exits 0", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    for (const command of SUBCOMMANDS) {
      expect(result.out).toContain(command);
    }
  });

  it("exits non-zero on an unknown command", async () => {
    expect((await run(["frobnicate"])).code).not.toBe(0);
  });

  it("exits non-zero when no command is given", async () => {
    expect((await run([])).code).not.toBe(0);
  });

  it("rejects `guard` without a label", async () => {
    const result = await run(["guard"]);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("--label");
  });
});
