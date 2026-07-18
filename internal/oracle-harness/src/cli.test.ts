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
  it("prints help listing every subcommand and exits 0", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    for (const command of SUBCOMMANDS) {
      expect(result.out).toContain(command);
    }
  });

  it("exits non-zero on an unknown command", () => {
    expect(run(["frobnicate"]).code).not.toBe(0);
  });

  it("exits non-zero when no command is given", () => {
    expect(run([]).code).not.toBe(0);
  });

  it("dispatches a known command to its stub", () => {
    const result = run(["snapshot"]);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("not implemented");
  });
});
