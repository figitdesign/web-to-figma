import { describe, expect, it } from "vitest";
import { run } from "./cli";

const SUBCOMMANDS = [
  "snapshot",
  "figma",
  "report",
  "check",
  "calibrate",
  "guard",
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

  it("dispatches an unimplemented command to its stub", async () => {
    // `check` is still a stub; `snapshot`/`report` now do real work.
    const result = await run(["check"]);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("not implemented");
  });
});
