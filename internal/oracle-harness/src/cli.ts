import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { calibrate } from "./calibrate";
import { loadEnv } from "./env";
import { EXIT } from "./exit-codes";
import { cleanCanvas, openFigma } from "./figma/paste";
import type { SceneCapture } from "./figma/run";
import { captureScene } from "./figma/run";
import type { SessionConfig } from "./figma/session";
import {
  resolveSessionConfig,
  saveLoginSession,
  validateSession,
} from "./figma/session";
import {
  renderHistoryLine,
  serializeHistoryLine,
  summarizeRun,
} from "./history";
import type { LedgerEntry } from "./ledger";
import { park, reconcile, recordAttempt, selectNextClass } from "./ledger";
import {
  readLedger,
  readRunCounter,
  writeLedger,
  writeRunCounter,
} from "./ledger-io";
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
  updateBaseline,
} from "./scoreboard";
import { runSnapshot } from "./snapshot";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BASELINE_PATH = resolve(
  import.meta.dirname,
  "../baseline/scoreboard.json"
);

/** Resolve a relative session-state path against the repo root, so it works
 * regardless of the cwd the CLI is invoked from. */
function absStatePath(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

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
  {
    name: "figma",
    summary: "drive Figma: login | validate | paste <scene> | run (corpus)",
  },
  {
    name: "report",
    summary: "merge tier outputs into report.json and reconcile the ledger",
  },
  { name: "check", summary: "compare a run against the committed baseline" },
  {
    name: "ledger",
    summary: "reconcile/select/status/park/attempt on the findings ledger",
  },
  { name: "calibrate", summary: "measure Figma's render noise floor" },
  { name: "history", summary: "append a run summary line to runs.ndjson" },
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
    const previous = existsSync(BASELINE_PATH)
      ? (JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Scoreboard)
      : null;
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(
      BASELINE_PATH,
      serializeScoreboard(updateBaseline(current, previous))
    );
    return {
      code: EXIT.OK,
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
      code: EXIT.OK,
      out: `parity check passed (${sceneCount} scenes)${improvements}\n`,
      err: "",
    };
  }
  const detail = result.regressions
    .map((r) => `  ${r.sceneId} ${r.metric}: ${r.detail}`)
    .join("\n");
  return {
    code: EXIT.REGRESSION,
    out: "",
    err: `parity check FAILED — ${result.regressions.length} regression(s):\n${detail}\n`,
  };
}

function ledgerStatusLine(entry: LedgerEntry): string {
  const cool =
    entry.cooldownUntilRun === null
      ? ""
      : ` cooldown→${entry.cooldownUntilRun}`;
  return `  ${entry.class} [${entry.status}] sev ${entry.severity.toFixed(2)} attempts ${entry.attempts}${cool}`;
}

function runLedgerCommand(args: ReadonlyArray<string>): CliResult {
  const [action, ...rest] = args;
  const { values } = parseArgs({
    args: [...rest],
    options: {
      "run-id": { type: "string", default: "parity" },
      class: { type: "string" },
      verdict: { type: "string" },
      what: { type: "string" },
      why: { type: "string" },
      cooldown: { type: "string" },
    },
    allowPositionals: false,
  });
  const runId = values["run-id"] ?? "parity";

  if (action === "status") {
    const entries = readLedger();
    if (entries.size === 0) {
      return { code: 0, out: "ledger empty\n", err: "" };
    }
    const rows = [...entries.values()].map(ledgerStatusLine);
    return { code: 0, out: `${rows.join("\n")}\n`, err: "" };
  }

  if (action === "select") {
    const cls = selectNextClass(
      loadRunReport(runId),
      readLedger(),
      readRunCounter()
    );
    return { code: 0, out: `${cls ?? "none"}\n`, err: "" };
  }

  if (action === "reconcile") {
    const counter = readRunCounter() + 1;
    const { entries, resolved } = reconcile(
      readLedger(),
      loadRunReport(runId),
      { runId }
    );
    writeLedger(entries, resolved);
    writeRunCounter(counter);
    return {
      code: 0,
      out: `ledger reconciled (run ${counter}): ${entries.size} entries, ${resolved.length} resolved\n`,
      err: "",
    };
  }

  if (action === "park") {
    if (!(values.class && values.verdict)) {
      return { code: 1, out: "", err: "park requires --class and --verdict\n" };
    }
    const entries = readLedger();
    const entry = entries.get(values.class);
    if (!entry) {
      return { code: 1, out: "", err: `no ledger entry for ${values.class}\n` };
    }
    entries.set(values.class, park(entry, values.verdict));
    writeLedger(entries, []);
    return { code: 0, out: `parked ${values.class}\n`, err: "" };
  }

  if (action === "attempt") {
    if (!(values.class && values.what && values.why)) {
      return {
        code: 1,
        out: "",
        err: "attempt requires --class, --what and --why\n",
      };
    }
    const entries = readLedger();
    const entry = entries.get(values.class);
    if (!entry) {
      return { code: 1, out: "", err: `no ledger entry for ${values.class}\n` };
    }
    entries.set(
      values.class,
      recordAttempt(entry, {
        runId,
        whatTried: values.what,
        whyFailed: values.why,
        runCounter: readRunCounter(),
        cooldownRuns: values.cooldown ? Number(values.cooldown) : undefined,
      })
    );
    writeLedger(entries, []);
    return { code: 0, out: `recorded attempt on ${values.class}\n`, err: "" };
  }

  return {
    code: 1,
    out: "",
    err: `unknown ledger action '${action ?? ""}' (reconcile|select|status|park|attempt)\n`,
  };
}

type FigmaConfigResult =
  | { ok: true; config: SessionConfig }
  | { ok: false; message: string };

/** Resolve session config from env and absolutize a relative state path. */
function resolveFigmaConfig(): FigmaConfigResult {
  const resolved = resolveSessionConfig(loadEnv());
  if (!resolved.ok) {
    const list = resolved.errors.map((e) => `  - ${e}`).join("\n");
    return { ok: false, message: `Figma config incomplete:\n${list}\n` };
  }
  const { storageState } = resolved.config;
  const config: SessionConfig =
    storageState.kind === "path"
      ? {
          ...resolved.config,
          storageState: {
            kind: "path",
            path: absStatePath(storageState.path),
          },
        }
      : resolved.config;
  return { ok: true, config };
}

async function runFigmaLogin(): Promise<CliResult> {
  const raw = loadEnv().FIGMA_STORAGE_STATE?.trim();
  // login writes a session file; inline/base64 states can't be a target.
  const target =
    raw && !(raw.startsWith("{") || raw.length > 200)
      ? raw
      : ".figma-storage-state.json";
  await saveLoginSession(absStatePath(target));
  return { code: EXIT.OK, out: "", err: "" };
}

async function runFigmaValidate(): Promise<CliResult> {
  const resolved = resolveFigmaConfig();
  if (!resolved.ok) {
    return { code: EXIT.ERROR, out: "", err: resolved.message };
  }
  const result = await validateSession(resolved.config);
  if (result.ok) {
    return {
      code: EXIT.OK,
      out: `Figma session OK (file ${resolved.config.fileKey})\n`,
      err: "",
    };
  }
  return {
    code: EXIT.SESSION_EXPIRED,
    out: "",
    err: `Figma session invalid: ${result.reason}\n`,
  };
}

/** Capture Figma's rendered PNG and diff it against the DOM screenshot from a
 * prior snapshot run. Returns a one-line summary. */
function captureLine(capture: SceneCapture): string {
  if (!capture.settled) {
    return `  ${capture.sceneId}: FAILED (${capture.note})`;
  }
  const tier2 =
    capture.tier2DiffRatio === null
      ? capture.note || "tier-2 —"
      : `tier-2 ${(capture.tier2DiffRatio * 100).toFixed(2)}% (${capture.tier2Regions} regions)`;
  return `  ${capture.sceneId}: tier-1 ${capture.tier1Findings}, ${tier2}`;
}

/** Open one Figma session and capture tier-1/2 for each scene that has a
 * payload in the run dir (produced by a prior snapshot). */
async function figmaCapture(
  runId: string,
  sceneIds: ReadonlyArray<string>
): Promise<CliResult> {
  const resolved = resolveFigmaConfig();
  if (!resolved.ok) {
    return { code: EXIT.ERROR, out: "", err: resolved.message };
  }
  const dir = createRunDir(runId);
  const scenes = discoverScenes().filter(
    (s) =>
      sceneIds.includes(s.id) &&
      existsSync(resolve(dir.payloads, `${s.id.replaceAll("/", "__")}.html`))
  );
  if (scenes.length === 0) {
    return {
      code: EXIT.ERROR,
      out: "",
      err: "no scenes with payloads in the run — run `snapshot` first\n",
    };
  }

  const session = await openFigma(resolved.config);
  const captures: Array<SceneCapture> = [];
  try {
    for (const scene of scenes) {
      try {
        const envelope = readFileSync(
          resolve(dir.payloads, `${scene.id.replaceAll("/", "__")}.html`),
          "utf-8"
        );
        captures.push(
          await captureScene({ page: session.page, dir, scene, envelope })
        );
      } catch (error) {
        // One scene's failure must not abort the whole corpus run.
        const message = error instanceof Error ? error.message : String(error);
        captures.push({
          sceneId: scene.id,
          settled: false,
          tier1Findings: 0,
          tier2DiffRatio: null,
          tier2Regions: null,
          note: `error: ${message}`,
        });
      }
    }
    // Leave the scratch file empty so frames never accumulate across runs.
    await cleanCanvas(session.page);
  } finally {
    await session.browser.close();
  }

  const failed = captures.filter((c) => !c.settled).length;
  return {
    code: failed > 0 ? EXIT.PASTE_FAILED : EXIT.OK,
    out: `figma capture → ${dir.root}\n${captures.map(captureLine).join("\n")}\n${captures.length} scenes, ${failed} failed\n`,
    err: "",
  };
}

async function runCalibrateCommand(
  args: ReadonlyArray<string>
): Promise<CliResult> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "run-id": { type: "string", default: "parity" },
      scene: { type: "string", multiple: true },
    },
    allowPositionals: false,
  });
  const resolved = resolveFigmaConfig();
  if (!resolved.ok) {
    return { code: EXIT.ERROR, out: "", err: resolved.message };
  }
  const dir = createRunDir(values["run-id"] ?? "parity");
  const stem = (id: string) => id.replaceAll("/", "__");
  const withPayload = discoverScenes().filter((s) =>
    existsSync(resolve(dir.payloads, `${stem(s.id)}.html`))
  );
  const filter = values.scene ?? [];
  // A few scenes are enough to characterize render determinism.
  const chosen = (
    filter.length > 0
      ? withPayload.filter((s) => filter.includes(s.id))
      : withPayload
  ).slice(0, 3);
  if (chosen.length === 0) {
    return {
      code: EXIT.ERROR,
      out: "",
      err: "no scenes with payloads — run `snapshot` first\n",
    };
  }
  const scenes = chosen.map((scene) => ({
    scene,
    envelope: readFileSync(
      resolve(dir.payloads, `${stem(scene.id)}.html`),
      "utf-8"
    ),
  }));

  const session = await openFigma(resolved.config);
  let result: Awaited<ReturnType<typeof calibrate>>;
  try {
    result = await calibrate({ page: session.page, dir, scenes });
    await cleanCanvas(session.page);
  } finally {
    await session.browser.close();
  }
  const rows = Object.entries(result.figmaRenderNoise).map(
    ([id, n]) => `  ${id}: render noise ${(n * 100).toFixed(4)}%`
  );
  return {
    code: EXIT.OK,
    out: `calibration → ${dir.root}/calibration.json\n${rows.join("\n")}\nmax render noise: ${(result.maxRenderNoise * 100).toFixed(4)}%\nrecommended noise floor: ${(result.recommendedNoiseFloor * 100).toFixed(3)}%\n`,
    err: "",
  };
}

/** Append a one-line summary of a run to the rolling `runs.ndjson` history
 * (WS-3.3) and, in CI, mirror it into the step summary. */
function runHistoryCommand(args: ReadonlyArray<string>): CliResult {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "run-id": { type: "string", default: "parity" },
      path: { type: "string", default: "oracle/history/runs.ndjson" },
    },
    allowPositionals: false,
  });
  const record = summarizeRun(loadRunReport(values["run-id"] ?? "parity"));
  const historyPath = absStatePath(values.path ?? "oracle/history/runs.ndjson");
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, serializeHistoryLine(record));

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `\n${renderHistoryLine(record)}\n`);
  }
  return {
    code: EXIT.OK,
    out: `history → ${historyPath}\n${renderHistoryLine(record)}\n`,
    err: "",
  };
}

async function runFigmaCommand(
  args: ReadonlyArray<string>
): Promise<CliResult> {
  const action = args[0];
  if (action === "login") {
    return await runFigmaLogin();
  }
  if (action === "validate") {
    return await runFigmaValidate();
  }
  if (action === "paste" || action === "run") {
    // `paste <scene>` (positional, as the help advertises) and `--scene <id>`
    // are equivalent; both may repeat.
    const { values, positionals } = parseArgs({
      args: [...args.slice(1)],
      options: {
        "run-id": { type: "string", default: "parity" },
        scene: { type: "string", multiple: true },
      },
      allowPositionals: true,
    });
    const filter = [...positionals, ...(values.scene ?? [])];
    const sceneIds =
      filter.length > 0 ? filter : discoverScenes().map((s) => s.id);
    return await figmaCapture(values["run-id"] ?? "parity", sceneIds);
  }
  return {
    code: EXIT.ERROR,
    out: "",
    err: `unknown figma action '${action ?? ""}' (login|validate|paste|run)\n`,
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
  if (command === "figma") {
    return await runFigmaCommand(argv.slice(1));
  }
  if (command === "report") {
    return runReportCommand(argv.slice(1));
  }
  if (command === "check") {
    return runCheckCommand(argv.slice(1));
  }
  if (command === "ledger") {
    return runLedgerCommand(argv.slice(1));
  }
  if (command === "calibrate") {
    return await runCalibrateCommand(argv.slice(1));
  }
  if (command === "history") {
    return runHistoryCommand(argv.slice(1));
  }
  return {
    code: 1,
    out: "",
    err: `Unknown command: ${command}\n\n${helpText()}`,
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
