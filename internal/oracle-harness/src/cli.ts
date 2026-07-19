import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assertReport } from "./report";
import { renderStepSummary } from "./report-html";
import { assembleReport, writeReport } from "./report-io";
import { createRunDir } from "./run-dir";
import { discoverScenes } from "./scenes";
import type { Scoreboard } from "./scoreboard";
import {
  buildScoreboard,
  checkScoreboard,
  serializeScoreboard,
} from "./scoreboard";
import { runSnapshot } from "./snapshot";

const BASELINE_PATH = resolve(
  import.meta.dirname,
  "../baseline/scoreboard.json"
);

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

async function runSnapshotCommand(
  args: ReadonlyArray<string>
): Promise<CliResult> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      layout: { type: "string", default: "auto" },
      scene: { type: "string", multiple: true },
      "run-id": { type: "string", default: "local" },
    },
    allowPositionals: false,
  });

  const layout = values.layout === "absolute" ? "absolute" : "auto";
  const all = discoverScenes();
  const filter = values.scene ?? [];
  const scenes =
    filter.length > 0 ? all.filter((s) => filter.includes(s.id)) : all;
  if (scenes.length === 0) {
    return { code: 1, out: "", err: "No scenes matched the --scene filter.\n" };
  }

  const runId = values["run-id"] ?? "local";
  const dir = createRunDir(runId);
  const results = await runSnapshot({ scenes, layout, outDir: dir.root });

  const totalFindings = results.reduce((n, r) => n + r.tier0Findings, 0);
  const rows = results.map(
    (r) =>
      `  ${r.sceneId}: ${r.nodeChanges} nodes, ${r.elements} elements, ${r.tier0Findings} tier-0 findings`
  );
  return {
    code: 0,
    out: `snapshot (${layout}) → ${dir.root}\n${rows.join("\n")}\ntotal tier-0 findings: ${totalFindings}\n`,
    err: "",
  };
}

function runReportCommand(args: ReadonlyArray<string>): CliResult {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "run-id": { type: "string", default: "local" },
      commit: { type: "string", default: "unknown" },
    },
    allowPositionals: false,
  });
  const runId = values["run-id"] ?? "local";
  const dir = createRunDir(runId);
  const report = assembleReport(dir.root, {
    runId,
    commit: values.commit ?? "unknown",
    createdAt: new Date().toISOString(),
  });
  writeReport(dir.root, report);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, renderStepSummary(report));
  }

  const top = report.classes
    .slice(0, 3)
    .map(
      (c) => `  ${c.class} ×${c.count} (Σsev ${c.aggregateSeverity.toFixed(2)})`
    )
    .join("\n");
  return {
    code: 0,
    out: `report → ${dir.root}/report.json\n${report.findings.length} findings across ${report.classes.length} classes\n${top}\n`,
    err: "",
  };
}

function loadRunReport(runId: string) {
  const dir = createRunDir(runId);
  const report = JSON.parse(
    readFileSync(resolve(dir.root, "report.json"), "utf-8")
  );
  assertReport(report);
  return report;
}

function runCheckCommand(args: ReadonlyArray<string>): CliResult {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "run-id": { type: "string", default: "parity" },
      update: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const current = buildScoreboard(loadRunReport(values["run-id"] ?? "parity"));
  const sceneCount = Object.keys(current.scenes).length;

  if (values.update) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, serializeScoreboard(current));
    return {
      code: 0,
      out: `baseline updated → ${BASELINE_PATH} (${sceneCount} scenes)\n`,
      err: "",
    };
  }

  const baseline = JSON.parse(
    readFileSync(BASELINE_PATH, "utf-8")
  ) as Scoreboard;
  const result = checkScoreboard(current, baseline);
  if (result.ok) {
    const improvements =
      result.improvements.length > 0
        ? `\nimprovements:\n${result.improvements
            .map((i) => `  ${i.sceneId} ${i.metric}: ${i.detail}`)
            .join("\n")}\n`
        : "";
    return {
      code: 0,
      out: `parity check passed (${sceneCount} scenes)${improvements}\n`,
      err: "",
    };
  }
  const detail = result.regressions
    .map((r) => `  ${r.sceneId} ${r.metric}: ${r.detail}`)
    .join("\n");
  return {
    code: 1,
    out: "",
    err: `parity check FAILED — ${result.regressions.length} regression(s):\n${detail}\n`,
  };
}

/** Parse and dispatch a CLI invocation. Returns the exit code and the text to
 * emit, so it can be unit-tested without spawning a process. */
export async function run(argv: ReadonlyArray<string>): Promise<CliResult> {
  const command = argv[0];

  if (command === "--help" || command === "-h") {
    return { code: 0, out: helpText(), err: "" };
  }
  if (command === undefined) {
    return { code: 1, out: "", err: `Missing command.\n\n${helpText()}` };
  }
  if (command === "snapshot") {
    return await runSnapshotCommand(argv.slice(1));
  }
  if (command === "report") {
    return runReportCommand(argv.slice(1));
  }
  if (command === "check") {
    return runCheckCommand(argv.slice(1));
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
  const result = await run(process.argv.slice(2));
  if (result.out) {
    process.stdout.write(result.out);
  }
  if (result.err) {
    process.stderr.write(result.err);
  }
  process.exit(result.code);
}
