import process from "node:process";
import { pathToFileURL } from "node:url";

export type CliResult = { code: number; out: string; err: string };

/**
 * The harness subcommands. Each is filled in by a later workstream; until then
 * it dispatches to a stub. Order is the pipeline order.
 */
const COMMANDS: ReadonlyArray<{ name: string; summary: string }> = [
  {
    name: "snapshot",
    summary: "render scenes, capture ground truth + payload, run tier-0 diff",
  },
  { name: "figma", summary: "paste into Figma, capture tier-1/2 findings" },
  {
    name: "report",
    summary: "merge tier outputs into report.json and reconcile the ledger",
  },
  { name: "check", summary: "compare a run against the committed baseline" },
  { name: "calibrate", summary: "measure Figma's render noise floor" },
  { name: "guard", summary: "enforce oracle PR path/diff rules" },
];

function helpText(): string {
  const rows = COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`);
  return [
    "oracle-harness — visual parity pipeline",
    "",
    "Usage: tsx src/cli.ts <command> [options]",
    "",
    "Commands:",
    ...rows,
    "",
  ].join("\n");
}

/** Parse and dispatch a CLI invocation. Pure: returns the exit code and the
 * text to emit, so it can be unit-tested without spawning a process. */
export function run(argv: ReadonlyArray<string>): CliResult {
  const command = argv[0];

  if (command === "--help" || command === "-h") {
    return { code: 0, out: helpText(), err: "" };
  }
  if (command === undefined) {
    return { code: 1, out: "", err: `Missing command.\n\n${helpText()}` };
  }
  if (!COMMANDS.some((c) => c.name === command)) {
    return {
      code: 1,
      out: "",
      err: `Unknown command: ${command}\n\n${helpText()}`,
    };
  }

  // Stub until the owning workstream lands.
  return {
    code: 1,
    out: "",
    err: `"${command}" is not implemented yet — see docs/visual-parity-pipeline.prd.md.\n`,
  };
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}

if (isMain()) {
  const result = run(process.argv.slice(2));
  if (result.out) {
    process.stdout.write(result.out);
  }
  if (result.err) {
    process.stderr.write(result.err);
  }
  process.exit(result.code);
}
