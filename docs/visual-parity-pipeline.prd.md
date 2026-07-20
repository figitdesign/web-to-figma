# PRD: Visual Parity Pipeline ("Parity Oracle")

| | |
|---|---|
| **Status** | Draft — approved direction, pending implementation |
| **Owner** | Nicco (@niko047) |
| **Audience** | Implementing agents and human reviewers |
| **Repo** | `figitdesign/web-to-figma` (this repo — everything lives here) |
| **Date** | 2026-07-18 |

## How to use this document (read first, implementers)

- Implement **one workstream per PR**, in order within a milestone. Workstreams list their dependencies; do not start one before its dependencies are merged.
- Every workstream has **Steps**, **Tests**, and a **Definition of Done**. A workstream is not done until its tests exist and pass in CI.
- Follow the repo conventions in **Appendix A** exactly (lint, commits, no attribution lines, tsx scripts, catalog versions). Deviating from them will fail CI or review.
- When a detail below is marked **Verify:**, confirm it against the code before building on it — this PRD was written against the repo at commit `2a1672f` and the code is the source of truth.
- Update the **Status tracker** table (§14) in this file as workstreams land.

---

## 1. Summary

`@figit/dom-to-figma` converts a live DOM into a Figma clipboard payload. The end goal of the product is **1:1 visual correspondence**: a scene rendered by the browser and the same scene pasted into Figma should look identical.

Today, verifying that correspondence is manual: a human runs `pnpm oracle:outbox`, opens the generated copy pages, pastes into Figma, eyeballs the result, copies it back, runs `pnpm oracle:capture` and `pnpm oracle:diff`. This PRD specifies the system that automates that loop end-to-end and puts an AI agent on top of it, so the pipeline can **run on a schedule, measure parity, localize discrepancies, fix the converter, and open PRs in this repo** — with humans only reviewing and merging.

The design principle throughout: **separate cheap, deterministic diagnosis from expensive, Figma-in-the-loop verification**, and make every discrepancy *actionable* (attributed to a specific DOM element, Figma node, and converter code path) rather than a bare "images differ by N%".

## 2. Goals and non-goals

### Goals

1. A **scored, automated parity measurement** for every scene in the corpus, at three fidelity tiers (local structural, Figma structural, Figma pixels).
2. **Zero-human runs**: a scheduled workflow converts the corpus, gets it into Figma, extracts Figma's interpretation (geometry + rendered pixels), diffs, and produces a machine-readable report.
3. **Autonomous improvement**: an agent consumes the report, fixes the highest-impact discrepancy in the converter, adds a regression scene, and opens a labeled PR in this repo.
4. **A ratchet**: parity scores can only improve. CI blocks any PR that regresses a scene's score against the committed baseline.
5. Runs **N times/day** (initially 1), triggered by cron, always building from `origin/main` source (never the published package).

### Non-goals

- Perfect pixel equality. Chrome and Figma rasterize (especially text) differently; the target is a calibrated, monotonically-shrinking diff, not zero.
- A Figma plugin. The product's premise is pluginless paste; the pipeline must exercise the real paste path.
- Auto-merge. Agent PRs are always reviewed by a human.
- Private/proprietary corpus (Sleek designs). Deferred to M4; architecture must not preclude it (corpus is directory-driven).
- Testing the browser extension or playground UIs. Only the conversion library's output parity.

## 3. Current state (inventory)

What exists and is reused — implementers should read these files before writing code:

| Asset | Path | Role in this pipeline |
|---|---|---|
| Converter entry | `packages/dom-to-figma/src/figma.ts` (`createFigmaConverter`) | System under test. Gains a `trace` option (WS-1.1). |
| DOM walk | `packages/dom-to-figma/src/converter/walk.ts` | Where trace entries are recorded. |
| Auto-layout inference (self-verifies at 0.6px) | `packages/dom-to-figma/src/converter/layout/infer.ts` | Prior art for geometry tolerance. |
| Kiwi encode/decode + clipboard envelope | `packages/fig-kiwi/src/{encoder,decoder,clipboard}.ts` | Payload decoding for diffs; envelope for paste injection. |
| Headless scene converter | `packages/dom-to-figma/scripts/oracle-outbox.ts` | Bundles library fresh from `src/` via tsdown, renders scenes in Playwright, converts, validates round-trip. **`--single` packs all scenes into one multi-frame canvas payload** — the primitive the Figma runner pastes. Also supports `--layout=auto` and per-scene size hints (`<!-- oracle: width=W height=H -->`). |
| Structural payload differ | `packages/fig-kiwi/scripts/oracle-diff.ts` | Existing sent-vs-captured diff: tree pairing by order, root pairing by frame name, default-value normalization, `NUMERIC_TOLERANCE = 0.11`, `GEOMETRY_TOLERANCE = 0.55`. Tier-1 copy-back diffing reuses this. |
| Clipboard capture | `packages/fig-kiwi/scripts/oracle-capture.ts` | Existing inbox capture; reused by the automated copy-back (WS-2.5). |
| Shared oracle helpers | `packages/fig-kiwi/scripts/oracle-shared.ts` | `treeOrder`, `STACK_DEFAULTS`, `TRACKED_STACK_FIELDS`. |
| Scene corpus | `packages/dom-to-figma/scripts/oracle-scenes/{00-smoke,01-flex,02-sizing,03-flow,04-wrap}` + `apps/playground/src/corpus/` (`corpus:<slug>` refs) | The test corpus. Grows over time; every agent fix must add a scene. |
| CI | `.github/workflows/ci.yml` (lint → typecheck → build → Playwright-cached tests) | Extended with a Tier-0 parity job (WS-1.6). |
| Test infra | Vitest; `dom-to-figma` has `unit` (node) and `browser` (Chromium via `@vitest/browser-playwright`) projects | New pure-logic tests go in `unit`-style node projects; DOM-dependent tests in browser projects. |
| Script runner | `tsx` (see `packages/fig-kiwi/package.json` scripts) | New harness CLI runs the same way. |
| Playwright | `playwright@^1.50.0` devDep of `dom-to-figma` | Reused by ground-truth capture and the Figma runner. |
| Gitignore | `/oracle/` is root-ignored (human-oracle exchange dirs `oracle/{inbox,outbox}`) | Run artifacts stay under `/oracle/runs/` (ignored). The committed baseline must live **outside** `/oracle/` (see §6.4). |
| Agent commands | `.claude/commands/*.md` (check-pr-review, commit, create-pr, deslop) | Convention for the new `/fix-discrepancy` command. Note: repo convention is **no attribution lines** in commits/PRs. |

## 4. Glossary

- **Scene** — one HTML file (oracle scene or corpus ref) rendered at a declared size; the atomic unit of the corpus.
- **Payload** — the kiwi-encoded clipboard output of the converter for a scene.
- **Trace map** — sidecar metadata linking every emitted Figma node GUID to its source DOM element (WS-1.1).
- **Ground truth** — per-element rects/styles + a screenshot captured from the browser rendering of a scene (WS-1.3).
- **Tier 0** — local diff: payload vs. ground truth. No Figma. Milliseconds. Catches converter measurement/translation bugs.
- **Tier 1** — structural diff: the kiwi payload we **sent** vs. the kiwi payload Figma **returns when the rendered frame is copied back** (same format both sides), compared with the existing `oracle-diff` logic. Catches Figma reinterpretation (auto-layout re-flow, font metric differences, default normalization). No REST.
- **Tier 2** — pixel diff: Figma's PNG export of the pasted frame vs. the browser screenshot. The parity *score*.
- **Finding** — one localized discrepancy (scene, node, field/region, expected vs. actual, severity).
- **Discrepancy class** — a family of findings sharing a root-cause signature (e.g. `text.lineHeight`, `layout.stackSpacing`), used for ranking and for the one-class-per-PR rule.
- **Scoreboard / ratchet** — committed per-scene metrics baseline; CI fails on regression.
- **Findings ledger** — committed, human-readable, per-class record of discrepancies that persist across runs: analysis, accumulated attempt history, and lifecycle status (`open` / `attempting` / `parked` / `resolved`). The agent's cross-run memory: it decides what to skip, retry, or work next (WS-1.7). Distinct from the scoreboard, which stores the *magnitude* of accepted imperfections; the ledger stores their *identity, why, and what was tried*.

## 5. Architecture

```
                                        ┌───────────────────────────── inner loop (PR CI, agent iteration; no secrets)
  corpus scene ──► Playwright render ───┤
  (HTML file)      • ground truth       │  Tier 0: payload ⟷ ground truth
                   • screenshot         │          (structural, local, ~ms)
                   • convert (trace on) │
                        │               └─────────────────────────────
                        ▼
                 multi-frame payload (--single, one per batch)
                        │
        ┌───────────────┴───────────────── outer loop (scheduled, secrets required)
        ▼
  Figma runner (Playwright on figma.com, dedicated account + scratch file)
        │  1. clean page   2. paste payload   3. wait for import
        ▼
  ├─ select frame → Copy (Cmd+C) ──► Tier 1: kiwi copy-back ⟷ sent kiwi (via oracle-diff)
  └─ select frame → Copy as PNG ───► Tier 2: Figma rendered PNG ⟷ browser screenshot
     (REST GET /v1/images is an optional token-gated Tier-2 fallback only)
                                              │ pixel diff → clusters → node attribution
                                              ▼
                    report.json + scoreboard + findings ledger + artifacts
                                              │
                                              ▼
                 agent (/fix-discrepancy, headless Claude, scheduled)
                   reads ledger (skip parked / cooled-down classes) → works top *fixable* class
                   fix converter + repro scene + update baseline & ledger → PR (label: oracle-fix)
                   └─ if unsolvable after budget: park it in the ledger (+ optional issue), advance
                                              │
                                              ▼
                        human review → merge → next run measures the improvement
```

Failure-source separation is the load-bearing idea: **Tier 0 diagnoses converter bugs locally in the agent's edit-test loop**; Tiers 1–2 run against real Figma on the schedule and both *verify* fixes and *discover* reinterpretation bugs Tier 0 cannot see.

## 6. Data contracts

All schemas live in `internal/oracle-harness/src/report/schema.ts` as TypeScript types plus runtime validators (see WS-1.5). They are versioned with a top-level `schemaVersion` integer; agents must bump it on breaking changes.

### 6.1 Trace map (emitted by the converter, WS-1.1)

```ts
type TraceEntry = {
  guid: string;                 // emitted node GUID, "sessionID:localID"
  kind: "frame" | "text" | "image" | "vector" | "group" | "form-with-placeholder";
  tag: string;                  // lowercase tag name; "#text" for text nodes
  domPath: string;              // unique selector from the scene root, built from
                                // :nth-child chains, e.g. ":scope > div:nth-child(2) > p:nth-child(1)";
                                // for text nodes: parent selector + "::text[i]"
  rect: { x: number; y: number; width: number; height: number }; // page coords at convert time
  text?: string;                // first 120 chars, text nodes only
};
type ConvertTrace = { rootGuid: string; entries: TraceEntry[] };
```

Exposed as `result.trace` on `ConvertResult` **only when** `createFigmaConverter({ trace: true })`. Must be tree-shakeable dead weight when disabled and must not alter payload bytes.

### 6.2 Ground truth (per scene, WS-1.3)

```ts
type GroundTruth = {
  sceneId: string;              // e.g. "01-flex/row-gap" or "corpus-layout-flex"
  width: number; height: number; dpr: number;   // dpr fixed at 1 (see §12)
  screenshotPath: string;       // PNG, viewport-clipped to the scene frame
  elements: Array<{
    domPath: string;            // matches TraceEntry.domPath
    rect: Rect;                 // getBoundingClientRect, page coords
    styles: Record<string, string>; // curated computed-style subset (see WS-1.3 step 4)
    visible: boolean;
  }>;
};
```

### 6.3 Report (per run, WS-1.5)

```ts
type Finding = {
  id: string;                   // stable content hash of (sceneId, domPath|guid, class, field) — NOT random
  sceneId: string;
  tier: 0 | 1 | 2;
  class: string;                // dot-path discrepancy class, e.g. "layout.stackSpacing",
                                // "text.lineHeight", "paint.solid.color", "node.missing", "pixel.region"
  severity: number;             // 0..1 normalized magnitude (see WS-1.5 step 3)
  guid?: string; domPath?: string; field?: string;
  expected?: unknown; actual?: unknown; deltaPx?: number;
  clusterBBox?: Rect;           // tier 2 only, scene coords
  artifacts?: {                 // paths relative to the run dir
    domShot?: string; figmaShot?: string; diffShot?: string;
    cropDom?: string; cropFigma?: string;
  };
};

type SceneResult = {
  sceneId: string; layout: "auto" | "absolute";
  tier0: { findings: number; maxDeltaPx: number };
  tier1?: { findings: number; maxDeltaPx: number };
  tier2?: { diffRatio: number; clusters: number };  // diffRatio ∈ [0,1]
  error?: string;               // scene-level failure (convert threw, export failed…)
};

type ClassRollup = {
  class: string; count: number; scenes: string[];
  aggregateSeverity: number;    // ranking key: sum of severities across findings
  exemplarFindingId: string;    // the single best repro to hand the agent
};

type Report = {
  schemaVersion: 1;
  runId: string; commit: string; createdAt: string;  // injected by the runner, not Date.now() in workflow scripts
  tiersRun: Array<0 | 1 | 2>;
  scenes: SceneResult[]; findings: Finding[]; classes: ClassRollup[]; // classes sorted by aggregateSeverity desc
};
```

Written to `oracle/runs/<runId>/report.json` (gitignored) and uploaded as a workflow artifact.

### 6.4 Scoreboard baseline (committed, WS-1.6)

```ts
type Scoreboard = {
  schemaVersion: 1;
  scenes: Record<string /* sceneId */, {
    tier0: { findings: number; maxDeltaPx: number };
    tier1?: { findings: number; maxDeltaPx: number };
    tier2?: { diffRatio: number };
  }>;
};
```

Committed at **`internal/oracle-harness/baseline/scoreboard.json`** (NOT under `/oracle/`, which is gitignored). Ratchet rules in WS-1.6.

### 6.5 Findings ledger (committed, WS-1.7)

One markdown-with-frontmatter file **per discrepancy class**, at `internal/oracle-harness/known-findings/<class>.md` (class dots → path-safe, e.g. `text.lineHeight` → `text.lineHeight.md`). Committed and reviewed like code. Frontmatter carries the machine-read fields; the body is the human-read narrative that accumulates across attempts.

```yaml
---
class: text.lineHeight            # matches Finding.class; the file's identity
status: parked                    # open | attempting | parked | resolved
severity: 0.62                    # last-observed aggregateSeverity, for triage sorting
firstSeenRun: 20260718-9d4e875
lastSeenRun: 20260731-a1b2c3d
lastAttemptRun: 20260725-77aa10c  # omitted if never attempted
attempts: 3                       # count of autonomous fix attempts
cooldownUntilRun: null            # while set, ranking skips this class (transient backoff)
exemplarScene: 01-flex/tall-caption
exemplarFindingId: 9f3c2a1b4d5e
tier: 1                           # lowest tier at which it reproduces
issue: 142                        # optional GitHub issue mirror (dedupe key); null if none
---
## Analysis
<why the discrepancy happens; the Tier-0-clean / Tier-1-dirty signal if applicable>

## Attempts
- run 20260719 (a1b2…): <what was tried> → <why it failed>
- run 20260725 (77aa…): <what was tried> → <why it failed>

## Verdict
<for `parked`: the human decision needed, or the accepted-limitation rationale>
```

**Lifecycle & semantics** (enforced by WS-1.7 ranking and WS-3.2 `guard`):

| status | set by | ranking effect |
|---|---|---|
| `open` | report step, first time a class is seen and not yet in the ledger | eligible; ranked by `aggregateSeverity` |
| `attempting` | fix job at start of an attempt (transient, within one run) | locked — the concurrency group already serializes runs, so this is a crash marker |
| `parked` | fix job after exhausting its attempt budget, OR a human | **excluded** from autonomous selection; its magnitude is accepted into the scoreboard so the ratchet does not block other fixes |
| `resolved` | fix job when the class's findings drop to zero after a merge | file deleted in the fix PR (git history retains it) |

`schemaVersion` for the ledger format is recorded once in `internal/oracle-harness/known-findings/README.md`, not per file. Transient failure (ran out of turns, flaky run) sets `cooldownUntilRun` and keeps `status: open`; permanent failure (Figma structurally can't represent it, or the fix needs a tolerance/calibration decision the `guard` forbids the agent from making) sets `status: parked`. Only a human moves a `parked` entry back to `open`.

## 7. Milestone M1 — Local parity harness (no Figma credentials)

Outcome: every PR to this repo gets a deterministic Tier-0 parity check with a committed ratchet, and a `report.json` any agent can act on. Independently valuable before any Figma automation exists.

### WS-1.1 Converter trace mode

**Where**: `packages/dom-to-figma/src/` (public package — API addition needs a changeset, `minor`).

**Steps**

1. Add `trace?: boolean` to the converter config type in `figma.ts` (default `false`, documented in the package README).
2. Thread a trace collector through the walk context (`converter/walk.ts`). At each point a node change is emitted with a GUID, record a `TraceEntry` (§6.1). The `domPath` is built incrementally during the walk from child indices — do not re-derive it by querying the DOM afterwards.
3. Text nodes: record the parent element's path plus the text-node ordinal (`::text[i]`); when the walk splits a text node into per-line segments, all segments share the ordinal and get distinct GUIDs.
4. Expose `trace` on `ConvertResult`. Type it so it is `undefined` unless the flag is set.
5. Guard: when `trace` is false, no entries are allocated (not "collected then discarded").

**Tests** (in `packages/dom-to-figma`, browser project)

- `trace.browser.test.ts`:
  - Converting a nested fixture with `trace: true` yields exactly one entry per emitted node change; every `guid` in `result.document` node changes appears in the trace and vice versa (skip classifications excluded).
  - For every entry, `sceneRoot.querySelector(entry.domPath.replace("::text…",""))` resolves to exactly one element, and `entry.rect` matches its `getBoundingClientRect()` within 0.1px.
  - Payload bytes with `trace: true` are **byte-identical** to `trace: false` for the same fixture.
  - With `trace` unset, `result.trace === undefined`.
- Text-split fixture (a paragraph that wraps): each line segment traces to the same `domPath`, distinct GUIDs.

**Definition of done**: tests pass; changeset added; README documents the flag; knip clean.

### WS-1.2 Harness package scaffold

**Where**: new private package `internal/oracle-harness` (`@figit/oracle-harness`), mirroring `internal/ui` conventions (private, no publish, no build step; executed via `tsx`).

**Steps**

1. `package.json`: private, `type: module`, `engines.node >= 20`, deps: `playwright` (same range as dom-to-figma), `pixelmatch`, `pngjs`; devDeps: `tsx`, `vitest`, `typescript: catalog:`, `@types/node: catalog:`. Workspace deps: `@figit/dom-to-figma`, `@figit/fig-kiwi`.
2. CLI entry `src/cli.ts` with subcommands: `snapshot` (Tier 0), `figma` (Tiers 1–2), `report` (merge + rank), `check` (ratchet), `calibrate` (M2), `guard` (M3). Argument parsing with `node:util` `parseArgs` — no CLI framework.
3. Root `package.json` scripts: `oracle:parity` → `pnpm --filter @figit/oracle-harness cli snapshot --check`, `oracle:figma-run`, `oracle:calibrate`. Keep existing `oracle:*` scripts untouched (the human workflow remains a fallback).
4. Scene discovery module `src/scenes.ts`: enumerate `packages/dom-to-figma/scripts/oracle-scenes/**/*.html` and playground corpus refs, applying the same id/name/size-hint conventions as `oracle-outbox.ts` (`loadScene`). **Refactor, don't duplicate**: extract the scene-loading helpers from `oracle-outbox.ts` into a small shared module both consume.
5. Run-dir management: `oracle/runs/<runId>/` layout: `ground-truth/`, `payloads/`, `figma/`, `diff/`, `report.json`. `runId` = `<utcstamp>-<shortsha>` passed in by the caller.

**Tests**

- Unit: scene discovery returns every committed scene with correct id/size (snapshot-test the manifest against the checked-in scene files, so adding a scene updates the snapshot intentionally).
- Unit: CLI `--help` exits 0 and lists subcommands; unknown subcommand exits non-zero.

**Definition of done**: `pnpm -r check-types`, `pnpm lint`, `pnpm knip` clean; `pnpm --filter @figit/oracle-harness test` green; workspace builds unaffected.

### WS-1.3 Ground-truth + payload capture runner (`snapshot`, part 1)

**Where**: `internal/oracle-harness/src/{ground-truth,convert}.ts`.

**Steps**

1. Bundle the converter fresh from `src/` exactly as `oracle-outbox.ts` does (tsdown IIFE build). **Verify:** reuse its `.oracle-build` output path or extract the bundling helper into the shared module from WS-1.2.
2. Per scene, in a Playwright Chromium page at the scene's declared size, `deviceScaleFactor: 1`:
   a. Inject determinism CSS **before** content: `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }` and hide scrollbars.
   b. Load the scene HTML; await `document.fonts.ready` and image `decode()` for all `<img>`; settle two rAFs.
   c. Convert with `{ trace: true, layout }` (layout from CLI flag, default `auto`); capture payload envelope + trace.
   d. Extract ground truth: for each trace entry (plus every *visible* element the walk skipped — needed for `node.missing` detection), record rect and the curated style subset: `display, position, opacity, background-color, background-image, color, font-family, font-size, font-weight, line-height, letter-spacing, border-*-width, border-*-color, border-radius (4 corners), box-shadow, overflow, transform, z-index, gap, padding, flex-direction, justify-content, align-items`.
   e. Screenshot the scene root element (PNG, clip = root rect).
3. Write `ground-truth/<sceneId>.json`, `payloads/<sceneId>.html` (envelope), `payloads/<sceneId>.trace.json`, screenshots. Decode the envelope through `parseClipboardHtml` + `decodeFigmaData` before writing (same fail-fast the outbox does).
4. Determinism gate: `--repeat 2` flag re-runs a scene and asserts ground truth is identical (used in tests and calibration).

**Tests**

- Integration (node vitest, spawns Playwright; tagged so CI can cache browsers as it already does):
  - Running `snapshot` on `00-smoke/two-boxes.html` produces all four artifact kinds; screenshot dimensions equal declared scene size; every trace `domPath` exists in ground-truth `elements`.
  - Determinism: two consecutive runs of a text-heavy scene produce byte-identical ground-truth JSON and identical screenshot hashes. (If flaky, fix the harness — this invariant is the foundation of everything downstream.)
  - A scene with a webfont: ground truth is only captured after `fonts.ready` (assert the measured text width differs from a run with fonts blocked — proves the wait is effective). **Deferred:** the committed corpus is entirely system-font/no-image (hermetic by design), so there is no webfont scene to exercise this. Add this test alongside the first webfont fixture (the `fonts.ready` wait is already wired and covered indirectly by the determinism test).

**Definition of done**: `oracle:parity` (without `--check`) runs the full committed corpus locally in < 3 minutes and writes a complete run dir.

### WS-1.4 Tier-0 structural differ

**Where**: `internal/oracle-harness/src/tier0.ts` — a **pure function** `(payloadNodes, trace, groundTruth, options) → Finding[]`. No I/O; all I/O stays in the CLI layer.

**Steps**

1. Reconstruct each payload node's intended absolute rect (accumulate parent-relative transforms/positions from the node-change tree; reuse `treeOrder` from `oracle-shared.ts`).
2. Pair payload nodes ⟷ ground-truth elements via the trace (`guid → domPath`). Unpaired visible DOM elements → `node.missing` findings; payload nodes with no DOM source (other than converter-synthesized ones, e.g. text line segments and form placeholder children — maintain an explicit allowlist) → `node.extra`.
3. Compare per node, emitting one finding per mismatched field:
   - Geometry: `x, y, width, height`, tolerance **0.55px** (match `GEOMETRY_TOLERANCE`); class `geometry.<field>`; `severity = clamp(delta / 8px)`.
   - Solid fills vs. `background-color` (through the same color pipeline the converter uses — compare in Figma RGBA space, tolerance matching `NUMERIC_TOLERANCE = 0.11` per channel logic); class `paint.solid.color`.
   - Text: font size, resolved family, weight, line-height in px; classes `text.*`.
   - Opacity, corner radii, stroke weights; classes `paint.opacity`, `stroke.*`, `radius.*`.
4. Class names form a stable, documented vocabulary (enumerated in `schema.ts`); new classes are added deliberately, never ad hoc strings.

**Tests** (node unit tests — this module must be the best-tested code in the harness)

- Golden path: hand-built payload+truth fixture pairs with zero mismatch → `[]`.
- One test per class: inject a known perturbation (shift x by 2px; wrong fill; missing node; extra node; wrong line-height) → exactly the expected finding with expected class, delta, and severity.
- Tolerance boundaries: delta 0.5px → no finding; 0.6px → finding.
- Synthesized-node allowlist: text line segments and form placeholders do not produce `node.extra`.
- Property: findings are deterministic and order-stable for identical inputs (sort key documented).

**Definition of done**: Tier-0 findings on the current committed corpus are **zero** (if not, the discrepancies found are either fixed in small preparatory PRs or explicitly recorded in the baseline — see WS-1.6 — with a tracking note; do not silently widen tolerances to get to green).

### WS-1.5 Report generator + ranking

**Where**: `internal/oracle-harness/src/report/{schema,rank,render-html}.ts`.

**Steps**

1. Implement §6.3 types with a lightweight runtime validator (hand-rolled guards or `zod` — if adding `zod`, add it only to the harness package).
2. Finding `id` = sha256 of `(sceneId, domPath ?? guid, class, field)` truncated to 12 hex chars — stable across runs so the agent and humans can reference findings over time.
3. Severity normalization per tier: tier 0/1 geometry `clamp(deltaPx / 8)`; paints/text fixed at 0.5 unless color distance is large; tier 2 `clamp(clusterArea / sceneArea * 20)`. These constants live in one `severity.ts` file with comments; calibration (WS-2.6) may adjust them.
4. `ClassRollup` ranking: `aggregateSeverity = Σ severity`, sorted desc; `exemplarFindingId` = the finding whose scene has the fewest total findings (cleanest repro). This is the *raw* ranking by magnitude; the *ledger-aware* selection that skips parked/cooled-down classes is layered on top in WS-1.7 and is what the agent actually consumes — do not bake ledger logic into this module.
5. `render-html.ts`: single self-contained `report.html` in the run dir — per-scene table, per-class rollup, inline `<img>` for screenshots/diffs. No framework, no external assets (it gets uploaded as a CI artifact).
6. GitHub Actions step summary writer: a compact markdown table (scene, tier0/1 findings, tier2 diffRatio, delta vs. baseline) appended to `$GITHUB_STEP_SUMMARY` when the env var is present.

**Tests**

- Schema validation: valid report passes; missing field / wrong enum fails with a path-specific error.
- Ranking: fixture with three classes ranks by aggregate severity; exemplar selection prefers the smallest scene.
- ID stability: same logical finding across two constructed runs → same id; changed field → different id.
- HTML render: smoke test — output contains one row per scene and no unresolved template placeholders.

**Definition of done**: `cli report` merges tier outputs from a run dir into a valid `report.json` + `report.html`.

### WS-1.6 Scoreboard, ratchet, CI integration

**Where**: `internal/oracle-harness/src/report/scoreboard.ts`, baseline at `internal/oracle-harness/baseline/scoreboard.json`, CI in `.github/workflows/ci.yml`.

**Steps**

1. `cli check`: compare the current run's `SceneResult`s to the baseline. **Failure** (exit 1, per-scene explanatory message) when any of:
   - `tier0.findings` increases, or `tier0.maxDeltaPx` increases by > 0.25px;
   - `tier1.findings` increases (when tier 1 present in both);
   - `tier2.diffRatio` increases by > 0.002 (noise epsilon; recalibrated in WS-2.6);
   - a baseline scene is missing from the run (deleted scenes must be removed from the baseline in the same PR, which the message explains);
   - a run scene is absent from the baseline (new scenes must be added to the baseline in the same PR).
2. `cli check --update`: rewrite the baseline from the current run (used deliberately in fix PRs; the diff shows the improvement).
3. Baseline hygiene: JSON stable-sorted by sceneId so diffs are minimal and reviewable.
4. CI: add a `parity` job to `ci.yml` after build: restore Playwright cache, run `oracle:parity` (= `snapshot` Tier 0 + `report` + `check`) — **no secrets, runs on every PR including forks**. Upload the run dir as an artifact on failure.
5. Document the ratchet contract in `internal/oracle-harness/README.md` (how to read failures, when `--update` is legitimate).

**Tests**

- Unit (pure comparisons): improvement → exit 0 and lists improvements; each regression type → exit 1 with the scene and metric named; added/removed scene handling as specified; `--update` writes stable-sorted JSON.
- Meta: a repo test asserting the baseline file parses against the schema and covers exactly the committed corpus (keeps baseline and corpus in lockstep).

**Definition of done**: a PR that intentionally breaks geometry in `frame/converter.ts` (local experiment, not committed) fails the `parity` job with an actionable message; reverting passes.

### WS-1.7 Findings ledger + ledger-aware selection

**Where**: `internal/oracle-harness/src/ledger/{schema,io,select}.ts`, ledger dir `internal/oracle-harness/known-findings/`. Pure logic and file I/O only — no Figma, no secrets. Depends on WS-1.5.

Rationale: without a persisted, deduplicated, cross-run memory of discrepancies, every scheduled run re-ranks by raw severity, re-attempts the same unfixable top class, and either loops forever on it or opens duplicate issues — starving the fixable classes underneath it. The ledger (§6.5) is that memory. It exists in M1 (before any agent) so the data contract and the selection logic are proven by unit tests, not discovered live in M3.

**Steps**

1. Implement §6.5: frontmatter schema + runtime validator (`schema.ts`); read/parse/serialize the `known-findings/*.md` dir with **stable frontmatter key order** and body preserved verbatim except for programmatic Attempts-list appends (`io.ts`). Use a minimal, dependency-light frontmatter parse (hand-rolled or a tiny lib added only to the harness) — do not pull a heavyweight markdown toolchain.
2. `reconcile(report, ledger)` — pure: for each class in the report, upsert a ledger entry (create `open` if absent; refresh `severity`, `lastSeenRun`, `exemplarFindingId`, `tier`). For ledger entries whose class is **absent** from the report (no longer reproduces), mark `resolved` and flag for deletion. Never downgrade a human-set `parked` to `open`. Returns the mutated ledger + a change summary; the CLI writes files.
3. `selectNextClass(report, ledger, currentRunId)` — pure: from the report's raw ranking (WS-1.5), drop classes whose ledger status is `parked` or `attempting`, and those with `cooldownUntilRun` still in the future (compare against a monotonic run counter, not wall-clock). Return the highest-severity remaining class, or `null` ("nothing fixable now").
4. `park(class, verdict)` / `recordAttempt(class, runId, whatTried, whyFailed, {cooldownRuns?})` — pure transforms that append to the Attempts body and set the right frontmatter; the CLI persists. `park` requires a non-empty verdict.
5. CLI wiring: `cli report` calls `reconcile` and writes the ledger alongside `report.json`; add `cli ledger select --report <path>` (prints the chosen class or `none`), `cli ledger park --class <c> --verdict <text>`, `cli ledger status` (human summary table). A **monotonic run counter**: maintain an integer in `known-findings/.run-counter` (or derive from committed run history) so `cooldownUntilRun` math never depends on timestamps.
6. Reconciliation runs on the scheduled path only (it writes committed files); the PR-CI `parity` job reads the ledger read-only for `selectNextClass` sanity but never mutates it.

**Tests** (node unit — pure functions, exhaustively)

- Round-trip: parse → serialize a fixture ledger file is byte-stable (key order, body, trailing newline).
- `reconcile`: new class → `open` entry created; recurring class → fields refreshed, body untouched; class gone from report → `resolved`+delete flag; **`parked` entry whose class reappears in the report stays `parked`** (the anti-regression invariant — a parked bug must never silently re-enter the work queue).
- `selectNextClass`: parked/attempting excluded; cooldown in the future excluded, expired included; all-excluded → `null`; among eligible, highest severity wins; deterministic tie-break documented.
- `park` rejects empty verdict; `recordAttempt` appends a dated line and increments `attempts`; cooldown sets `cooldownUntilRun = currentRun + cooldownRuns` and keeps `status: open`.
- Validator rejects unknown `status`, missing required frontmatter, malformed class filename ↔ `class` field mismatch.

**Definition of done**: `cli ledger status` renders the current ledger; a committed fixture ledger with one `parked` and one `open` entry drives `selectNextClass` to pick the `open` one; `knip`/`lint`/`check-types` clean. Ships with an empty `known-findings/` (just `README.md` documenting the format + `schemaVersion`).

**M1 exit criteria**: all of WS-1.1 … WS-1.7 merged; `parity` job green on `main`; a seeded regression is caught by CI; `report.json` + reconciled ledger for the corpus exist as artifacts of every `main` build; `selectNextClass` proven by unit tests to skip parked classes.

## 8. Milestone M2 — Figma-in-the-loop (Tiers 1 & 2)

Outcome: a Playwright-driven, logged-in Figma session pastes the corpus into a real scratch file, lets Figma's engine render and re-lay-it-out, and captures — **from the same rendered frame, through the clipboard** — two things: the **kiwi structure Figma produced** (structural truth) and its **rendered pixels** (visual truth). The report gains Tier 1/2 findings. Requires the login session + file key (§11); **no REST token on the primary path**; none of this runs on PRs.

**Why clipboard copy-back, not REST.** Figma's REST `GET /v1/files/:key` returns Figma's own REST JSON schema — a *different serialization* from the **kiwi clipboard format** the entire pipeline speaks (what `@figit/fig-kiwi` encodes/decodes and what `oracle-diff` compares). Diffing against REST would mean re-mapping a foreign schema and would silently lose the kiwi-specific fields `oracle-diff` already tracks (stack / auto-layout properties). The clipboard **copy-back returns kiwi** — Figma's post-render result *in our exact format* — so it diffs cleanly with the existing `oracle:capture` / `oracle:diff` machinery. This milestone is that manual loop, automated: Playwright is the human who pastes, then copies the rendered frame back. (The REST *file-content* objection is about structure only; REST *image* export returns a plain PNG and remains an optional Tier-2 pixel fallback — see WS-2.5.)

### WS-2.1 Figma session bootstrap

**Steps**

1. Dedicated Figma account (decision D-1, §15) and one scratch file; record its key in `FIGMA_FILE_KEY`. The runner treats page 1 as a disposable buffer.
2. `cli figma login`: launches headed Chromium, human signs in once, saves Playwright `storageState` to the path in `FIGMA_STORAGE_STATE` (default `.figma-storage-state.json`, gitignored). Prints how to store it (base64) as a CI secret later. Document session lifetime and the re-login procedure in the README.
3. Config resolution in `src/figma/session.ts`: `FIGMA_STORAGE_STATE` (inline JSON or path) and `FIGMA_FILE_KEY` are **required**; `FIGMA_TOKEN` is **optional**, read only when the Tier-2 REST fallback (WS-2.5) is enabled. Fail fast with a checklist message if a required var is missing.
4. Session validation: open the file URL, assert the canvas surface appears within 60s, else exit with a distinct `SESSION_EXPIRED` code (a distinguishable failure — it means "re-login", not "parity broke").

**Tests**

- Unit: config resolution (env permutations, inline vs. path storage state, missing-var messages, token-optional).
- Live smoke (`FIGMA_ORACLE_LIVE=1` gate, excluded from PR CI): `figma login --validate-only` against stored state exits 0.

### WS-2.2 Paste runner

**Where**: `internal/oracle-harness/src/figma/{paste,cleanup}.ts`.

**Steps**

1. Build the batch payload: run the WS-1.3 snapshot output through the existing `--single` multi-frame packing (reuse the outbox's packing code via the shared module — **Verify:** frame names must be unique per scene id, since Tier 1 pairs by name exactly as `oracle-diff.ts:74-77` does).
2. Cleanup **at run start** (previous run's canvas stays for postmortem): focus canvas, Select All, Delete; confirm the page is empty by a copy-back that decodes to zero frames (poll with timeout) — no REST.
3. Paste, primary strategy: write the kiwi envelope to the real clipboard (`navigator.clipboard.write`, `text/html`, permissions granted for figma.com) then `keyboard.press("ControlOrMeta+V")`. Fallback strategy (behind `--paste=synthetic`): dispatch a synthetic `ClipboardEvent("paste")` on `document` carrying a `DataTransfer`. Implement both; the runner tries primary and falls back automatically. Log which path worked into the run metadata.
4. Import settlement: poll by attempting a copy-back (Select All → Copy → decode) until the page's top-level frame names equal the expected scene set (timeout 180s — image/font ingestion is asynchronous). Record settle time in run metadata.
5. Every step emits structured progress logs and, on failure, a full-page screenshot into the run dir — this runner is the flakiest component and must be diagnosable from CI artifacts alone.

**Tests**

- Unit: envelope → `DataTransfer` construction (the produced `text/html` string parses via `parseClipboardHtml` and decodes to the same node count).
- Unit: expected-frame-set computation from a scene manifest.
- Live smoke (gated): paste `00-smoke` batch into the scratch file; assert settlement finds both frames; cleanup empties the page. This is the M2 canary test — the scheduled workflow runs it before the full corpus.

### WS-2.3 Tier 1 — clipboard copy-back structural differ (primary)

**Where**: `internal/oracle-harness/src/figma/copyback.ts` + a shared kiwi-diff module + `src/tier1.ts`.

This is the load-bearing M2 workstream and the reason REST is dropped: it compares **what we sent** (our kiwi batch payload) against **what Figma returned** (the kiwi payload from copying the rendered frame) — both in the same format — reusing the proven `oracle-diff` comparison.

**Steps**

1. After settlement, Select All → Copy in the driven page; read `text/html` from the clipboard — this is the **kiwi payload Figma produced** after rendering. Write it to `figma/<batch>.captured.html` (the same format `oracle:capture` writes, so the existing inbox tooling stays compatible).
2. Decode both sides via `decodeFigmaData(parseClipboardHtml(...).fig)`: the sent batch payload vs. Figma's capture. Pair top-level frames by **name** and nodes by **tree order**, normalizing default-valued fields — **reuse `oracle-diff.ts`'s comparison** (extract its pairing + `TRACKED_STACK_FIELDS`/`STACK_DEFAULTS` logic into a shared module both `oracle-diff` and the harness consume; do not duplicate).
3. Translate each mismatch into a `tier: 1` Finding, class `kiwi.<field>` (e.g. `kiwi.stackSpacing`, `kiwi.size`, `kiwi.stackPrimaryAlignItems`), carrying sent/got values. Extend the `DISCREPANCY_CLASSES` vocabulary with the `kiwi.*` family. A node clean at Tier 0 but divergent here is, by construction, a **Figma reinterpretation** — flag that on the finding; it's the single most valuable diagnostic line for the fixing agent.
4. Per-scene Tier-1 metrics (finding count, max geometry delta) feed the scoreboard slot WS-1.6 already reserved (`SceneScore.tier1`).

**Tests**

- Unit: mismatch → finding translation against committed sent/captured fixture pairs — a clean pair yields no findings; a pair with a known `stackSpacing` delta yields exactly one `kiwi.stackSpacing`.
- Unit: frame-name pairing (renamed / missing frame → `frame.missing`; extra frame → `frame.extra`).
- Unit: default-value normalization (an omitted field on one side equals its default on the other → no finding).
- Live (gated): full `00-smoke` paste → copy-back → tier1 produces zero findings (or the known, baselined set).

### WS-2.4 Tier 2 — rendered pixels, diff, attribution

**Where**: `internal/oracle-harness/src/figma/pixels.ts` (capture) + `src/tier2/{pixel,cluster,attribute}.ts` (diff pure; image I/O at the edge).

**Steps**

1. Capture Figma's pixels **in-browser**: select each rendered frame and use Figma's "Copy as PNG" to place the rendered image on the clipboard, read the image, save `figma/<sceneId>.png`. **Verify** the exact interaction (menu item / shortcut) against the live UI in WS-2.x rather than assuming — Figma's shortcuts drift. If it proves unavailable or flaky headless, use the WS-2.5 fallback. This keeps the primary path token-free and symmetric with the Tier-1 copy-back (same select-then-copy gesture on the same frame).
2. Align: the browser DOM screenshot (WS-1.3) and the Figma PNG are both `dpr=1` at the declared scene size; assert dimensions match within 1px (pad/crop by the documented 1px slack; larger mismatch → scene-level `error`, not a pixel diff).
3. Diff with `pixelmatch` (`includeAA: false`, threshold 0.1 initial — calibrated in WS-2.6): produce `diffRatio`, diff PNG.
4. Cluster: connected components over the diff mask on an 8px grid; emit per-cluster bbox; ignore clusters < 16px² (AA noise floor, calibrated).
5. Attribute: for each cluster, the deepest trace/ground-truth node whose rect covers ≥ 60% of the cluster bbox; emit `pixel.region` findings carrying `clusterBBox`, the attributed `domPath`/`guid`, and cropped image pairs (dom/figma) as artifacts.
6. Per-scene `tier2.diffRatio` feeds the scoreboard.

**Tests**

- Committed tiny PNG fixture pairs (generated once by a fixture script, committed as binaries): identical pair → ratio 0, no clusters; pair with a known 20×20 red square delta → one cluster with expected bbox and ratio; pure-AA-edge pair → zero clusters after the noise floor.
- Attribution unit tests with synthetic rect trees: nested nodes → deepest wins; cluster spanning siblings → attributed to their common parent.
- Live (gated): `00-smoke` end-to-end produces a diffRatio below the calibrated threshold.

### WS-2.5 Tier 2 fallback — REST image export (optional, token-gated)

Build **only if** in-browser "Copy as PNG" (WS-2.4 step 1) proves unreliable headless. The REST *file-content* objection does **not** apply here — `GET /v1/images/:key?ids=<frameIds>&format=png&scale=1` returns a plain PNG, no structural format mismatch. Requires `FIGMA_TOKEN` (read-only) and the pasted frames' REST node ids (Figma re-ids on paste; resolve them by frame name via a single `GET /v1/files/:key?depth=1` page listing, or from the selected node's URL). Gate behind `--pixels=rest`; the primary path stays clipboard-only and token-free.

**Tests**: unit-test the image-URL builder and the name→node-id resolver against a committed sanitized page-listing fixture; live test gated.

### WS-2.6 Calibration

**Steps**

1. `cli calibrate`: paste the same batch twice into the scratch file (sequentially), capture both via the Tier-2 pixel mechanism, diff Figma-vs-Figma → the **render noise floor** per scene; also diff repeated browser screenshots → browser noise (should be 0).
2. Emit `calibration.json` (p50/p95 noise per scene class: text-heavy vs. geometric) and recommend: pixelmatch threshold, cluster noise floor, ratchet epsilon. Update the constants in `severity.ts` / `check` from its output in a reviewed PR.
3. Document the calibration procedure and cadence (re-run when Figma ships renderer changes — detectable as a fleet-wide diffRatio jump with no repo change; the scheduled workflow flags this pattern explicitly instead of opening a fix PR).

**Tests**: unit-test the stats aggregation on fixture data; the command itself is live-gated.

**M2 exit criteria**: the `figma` runner completes corpus → paste → copy-back (Tier 1) + pixel capture (Tier 2) → report, artifacts uploaded, zero human touches after the one-time login; calibration constants committed; live canary (`00-smoke`) green on three consecutive runs. No REST token required on the primary path.

## 9. Milestone M3 — Autonomous loop

Outcome: on a daily cron, the pipeline measures, an agent fixes the top discrepancy class, and a guarded PR appears in this repo.

### WS-3.1 `/fix-discrepancy` command

**Where**: `.claude/commands/fix-discrepancy.md`, following the existing command style (imperative markdown; first-principles judgment encouraged; **no attribution lines** — repo rule).

**Content requirements** (the command must instruct the agent to):

1. Input: a path to `report.json` (argument). Determine the target class via `cli ledger select --report <path>` (the ledger-aware selection from WS-1.7), **not** by reading `classes[0]` directly — this is what skips `parked` and cooled-down classes. If it returns `none`, exit successfully with "nothing fixable" (mirrors WS-3.2's severity-floor skip). Load the chosen class's `exemplarFindingId` finding, open the referenced artifacts, and read the class's ledger entry (§6.5) — its **Attempts** history tells you what has already been tried and failed; do not repeat those approaches.
2. **Reproduce before fixing**: write a *minimal* scene under `oracle-scenes/` (≤ ~20 lines of HTML) that exhibits the exemplar finding at Tier 0 where possible; where the class is Tier-1/2-only (Figma reinterpretation), encode the expectation as the best available lower-tier assertion (a unit test against the intended payload property) plus the scene, and state in the PR that live verification comes from the next scheduled run.
3. Fix in `packages/dom-to-figma/src/` (or `fig-kiwi` if encoding-level). Iterate against: targeted unit tests → `oracle:parity` on affected scenes → full `oracle:parity`.
4. Constraints: touch **one discrepancy class per PR**; do not modify tolerances, severity constants, or the ratchet to make a run pass; do not edit unrelated scenes or baselines beyond `check --update`.
5. Finish (success): `check --update`, mark the class `resolved` in the ledger (delete its file via `cli ledger` reconcile, since its findings are now zero), add a changeset (`patch` for fixes to published packages), run full `pnpm lint && pnpm check-types && pnpm test`, open a PR per `.claude/commands/create-pr.md` conventions with label `oracle-fix`, body containing: class fixed, findings before → after counts, scenes affected, link to the run artifact, and the repro scene name.
6. Finish (unsolved): if the fix isn't converging after the bounded iteration budget, **do not open a code PR**. Instead, record the outcome in the findings ledger and stop:
   - Transient/ran-out-of-budget → `cli ledger` `recordAttempt` with what was tried, why it failed, and a `cooldownRuns` backoff (status stays `open`; a later run retries it, informed by the appended history).
   - Genuinely unsolvable in the converter, or needs a human decision the `guard` forbids the agent from making (tolerance/calibration change, an editability tradeoff) → `cli ledger park` with a clear verdict stating the decision needed. Optionally open **one** GitHub issue (label `oracle-finding`) and record its number in the entry's `issue:` field for dedupe — never open a second issue for an already-parked class.
   - Either way the ledger change is committed on its own branch and opened as a small PR labeled `oracle-ledger` (so the human sees the analysis and, for `parked`, makes the call); the pipeline advances to the next fixable class on the following run.

**Tests**: commands are prose; the enforcement is WS-3.2's `guard` (mechanical) plus a **drill**: run the command manually once against an M2 report with a seeded known bug (introduce a deliberate off-by-line-height in a branch, run the pipeline, verify the agent produces a correct PR). The drill is the acceptance test for this workstream and must be performed before enabling the cron.

### WS-3.2 Scheduled workflow + guard

**Where**: `.github/workflows/oracle.yml`, `cli guard`.

**Steps**

1. Workflow triggers: `schedule` (one daily cron to start; adding entries = raising N) and `workflow_dispatch` (with `tiers` input for manual partial runs). **Never** `pull_request`/`push`. `concurrency: { group: oracle, cancel-in-progress: false }`.
2. Job `measure` (environment: `oracle`; secrets: `FIGMA_STORAGE_STATE`, `FIGMA_FILE_KEY`, plus `FIGMA_TOKEN` only if the REST pixel fallback is enabled): checkout `main`, pnpm install, build, run live canary (`00-smoke`), then full `figma` run Tiers 0–2, `report`, upload run dir artifact (14-day retention), write step summary. Distinct failure surface for `SESSION_EXPIRED` (notifies for human re-login rather than counting as a pipeline failure).
3. Job `fix` (needs `measure`; secrets: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `ORACLE_GH_TOKEN`): download the report artifact, run headless Claude Code (`claude -p "/fix-discrepancy <report path>"` with `--permission-mode acceptEdits`, bounded `--max-turns`, model per decision D-4), on a branch `oracle/fix-<class>-<runid>`. The PR is opened with `ORACLE_GH_TOKEN` (fine-grained: `contents: write`, `pull_requests: write`, this repo only) so that normal CI runs on it. Skip the job entirely when the report has zero classes above a severity floor — "nothing to fix" is a successful outcome, logged in the summary.
4. `cli guard` — runs in **PR CI** (extend the `parity` job), branching on PR label:
   - `oracle-fix` (code fix): diff touches only allowed paths (`packages/*/src`, `packages/*/scripts/oracle-scenes`, `apps/playground/src/corpus`, harness baseline + ledger, changesets, tests); ≥ 1 scene file added or modified; baseline diff is non-regressive (reuses `check`); severity/tolerance constant files unchanged; any ledger change is a `resolved` deletion only (a fix PR must not create/edit `parked` entries).
   - `oracle-ledger` (analysis only): diff touches **only** `known-findings/**` (and optionally a changeset-free issue link); no `src`/scene/baseline changes.
   - Both: the agent may **not** flip an existing `parked` entry to `open` or edit its verdict (only a human does that — guard diffs the frontmatter `status` transition and fails on agent-authored `parked → open`). Guard failures block merge like any CI failure.
5. Both jobs tolerate the other's absence (measure-only runs are valid; a human can trigger `fix` on an old artifact via dispatch input).

**Tests**

- Unit: `guard` path/diff rules (fixture diffs: legitimate fix passes; tolerance edit fails; missing scene fails; unrelated file touched fails).
- Workflow lint: add `actionlint` to CI (or a minimal YAML validation step) so workflow syntax errors are caught in PRs.
- End-to-end acceptance: the WS-3.1 drill executed through this workflow via `workflow_dispatch` on a branch with a seeded bug.

### WS-3.3 Observability

**Steps**

1. Persist a one-line-per-run history: append `{runId, commit, medianDiffRatio, totalFindings, classesTop3}` to a `runs.ndjson` kept as a rolling workflow artifact and printed in the step summary (no DB; revisit only if N grows).
2. Step summary always includes: corpus size, per-tier findings, top 5 classes, delta vs. previous run, link to `report.html`.
3. Failure taxonomy in exit codes (`SESSION_EXPIRED`, `PASTE_FAILED`, `EXPORT_FAILED`, `REGRESSION`, `OK`) so the workflow's failure notifications are self-explanatory.

**Tests**: unit-test summary rendering from a fixture report; taxonomy is asserted by the live-gated tests of WS-2.x.

**M3 exit criteria**: three consecutive scheduled runs where each either (a) opened a valid `oracle-fix` PR that passed CI + guard, (b) opened a valid `oracle-ledger` PR that parked or recorded an attempt on an unsolvable class, (c) correctly reported "nothing fixable" (severity floor or all-parked), or (d) failed with an accurate taxonomy code. Across a run of several days the selected class must **advance** (not re-attempt a parked one). Human review time per PR under ~10 minutes.

## 10. Milestone M4 — Corpus scale-out (post-MVP, sketch)

Specified at lower resolution intentionally; re-plan when M3 is live.

- **WS-4.1 Seeded scene generator**: property-based generation of flex/grid/text/style permutations from a seed manifest (committed, so scenes are reproducible — no runtime randomness in workflow scripts). New generated scenes enter the corpus through PRs like any scene. Tests: same seed → byte-identical scene; generated scenes pass the WS-1.3 determinism gate.
- **WS-4.2 Scene minimizer**: given a failing scene + finding class, bisect DOM subtrees/style declarations while the Tier-0 (preferred) or Tier-1 finding persists; output the minimal repro the agent debugs. Tests: on fixture bugs, minimized scene retains the finding class with monotonically fewer nodes.
- **WS-4.3 Real-world + private corpus overlay**: frozen (committed, self-contained, asset-inlined) real pages; a private repo checked out by the scheduled workflow via deploy key contributing additional scenes (Sleek designs). Findings from private scenes must pass through WS-4.2 minimization before appearing in public PRs/scene additions. Explicitly out of scope until the ratchet has been stable for a while.

## 11. Security & operations

- **Secrets** — GitHub Environment `oracle`: `FIGMA_STORAGE_STATE`, `FIGMA_FILE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth via `claude setup-token`; or `ANTHROPIC_API_KEY` for metered billing), `ORACLE_GH_TOKEN`, and **`FIGMA_TOKEN` only if** the Tier-2 REST fallback (WS-2.5) is enabled. Never available to `pull_request`-triggered workflows. PR-facing jobs (Tier-0 `parity`, `guard`) use no secrets by design. Provisioning + testing + credential-rotation runbook: [`docs/oracle-operations.md`](./oracle-operations.md).
- **Least privilege**: `ORACLE_GH_TOKEN` is a fine-grained PAT (or GitHub App) scoped to this repo, `contents: write` + `pull_requests: write` only. `FIGMA_STORAGE_STATE` is a live login session — treat it as a full credential. `FIGMA_TOKEN` (if used at all) is read-only (`file_read`).
- **Trigger discipline**: the agent and Figma jobs run only on `schedule`/`workflow_dispatch` from `main`. Untrusted (fork) code never executes adjacent to secrets.
- **Prompt-injection surface**: the agent's inputs are repo-controlled files (scenes, report.json). Live-fetched web content must never enter the corpus directly (M4 freezes pages into committed fixtures). Report fields derived from scene content (e.g. `text`) are data, not instructions — the command file says so explicitly.
- **Figma ToS posture**: UI automation of figma.com is a gray zone. Mitigations: dedicated account, one paste + one copy-back per run, low frequency (N ≤ a few/day). Capture is via the browser clipboard, not REST. Degraded mode if automation is ever blocked: the runner pauses after building the batch and a human performs the single paste + copy-back — everything else stays automated.
- **Runner**: GitHub-hosted Ubuntu with `xvfb-run` for the headed-fallback paste path. If Figma challenges datacenter IPs / sessions rot too fast, fall back to a self-hosted runner (decision D-5).
- **Spend controls**: `--max-turns` cap on the agent, one class per run, skip-below-severity-floor, concurrency group prevents overlap.

## 12. Determinism & measurement policy (normative)

1. Viewport = declared scene size; `deviceScaleFactor: 1`; Figma export `scale=1`. (Revisit 2× only if sub-pixel classes demand it — decision D-3.)
2. Corpus fonts: **Google Fonts only** (available inside Figma; the converter's default font loader already resolves Google Fonts). A scene using a font Figma would substitute is a corpus bug, enforced by a scene-lint check in `scenes.ts` (warn in M1, error from M2).
3. Images in scenes: local/inline (data URI or committed asset) only — no network fetches at render time.
4. Animations/transitions/caret disabled by injected CSS; screenshots after `fonts.ready` + image decode + two rAFs.
5. Pixel metrics are **scores and locators**; structural tiers are **diagnoses**. The agent should always seek the structural finding behind a pixel cluster before editing code.
6. All tolerances/epsilons/severity constants live in `severity.ts` + `calibration.json`, changed only via calibration PRs — never inside a fix PR (enforced by `guard`).

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Figma paste automation breaks (UI change, synthetic-event rejection) | Medium | Outer loop down | Dual paste strategies (WS-2.2); canary scene isolates failures; degraded human-paste mode; Tier 0 unaffected |
| Figma session expiry / bot challenge | High over months | Scheduled run fails | Distinct `SESSION_EXPIRED` taxonomy + documented 2-min re-login; self-hosted runner fallback |
| Pixel noise drowns signal (fonts AA) | Medium | False findings, agent churn | Calibration (WS-2.6); structural tiers primary; cluster noise floor; per-class thresholds |
| Agent overfits (tolerance-widening, baseline gaming) | Medium | Silent quality loss | `guard` forbids tolerance/constant edits; ratchet direction enforced; human review |
| Loop stalls on an unfixable top class (re-attempts / duplicate issues forever) | High without mitigation | No throughput | Findings ledger (WS-1.7): `parked`/cooldown classes excluded from selection; accepted magnitude baselined so other fixes proceed; `guard` blocks `parked→open` gaming |
| Figma renderer update shifts all scores | Low | Fleet-wide "regressions" | Fleet-wide-jump detection in WS-2.6 step 3 → recalibrate instead of fix |
| Corpus grows → run time | Low (N small) | Slow CI | Tier 0 stays on PR CI only; batched single-paste keeps Figma cost ~constant per run |
| `/oracle/` gitignore vs. committed baseline confusion | Certain if ignored | Baseline accidentally untracked | Baseline lives in `internal/oracle-harness/baseline/` (§6.4), never under `/oracle/` |

## 14. Status tracker

| Workstream | Milestone | Status | PR |
|---|---|---|---|
| WS-1.1 Converter trace mode | M1 | done (commit cb3c86c) | — |
| WS-1.2 Harness scaffold | M1 | done (commit 14ac60c) | — |
| WS-1.3 Ground-truth runner | M1 | done (commit 8061404) | — |
| WS-1.4 Tier-0 differ | M1 | done — geometry + missing/extra (commit 463efac); fills/text/radius to follow | — |
| WS-1.5 Report + ranking | M1 | done (commit 1fa8535) | — |
| WS-1.6 Scoreboard + ratchet + CI | M1 | done (commit e0ced82) | — |
| WS-1.7 Findings ledger + selection | M1 | done (commit c99bb9a) | — |
| WS-2.1 Session bootstrap | M2 | done (commit d4f88a1) | — |
| WS-2.2 Paste runner | M2 | done (commit 3ed4506) | — |
| M2 orchestration (`figma run` + tier-1/2 → scoreboard) | M2 | done (commit 6a1bf22); per-scene loop (batched single-paste still a perf TODO) | — |
| WS-2.3 Tier-1 copy-back differ | M2 | done (commit 3b5bcb7); shared diff extracted to fig-kiwi; batch packing still pending | — |
| WS-2.4 Tier-2 pixel pipeline | M2 | done (commit e093e43); Copy-as-PNG is 2×, downsampled to 1× | — |
| WS-2.5 REST pixel fallback (optional) | M2 | not started | — |
| WS-2.6 Calibration | M2 | done (commit 3dae76e); Figma render is deterministic (0%), 0.1% noise floor applied | — |
| WS-3.1 fix-discrepancy command | M3 | done (commit 8c770fa); `.claude/commands/fix-discrepancy.md` | — |
| WS-3.2 Scheduled workflow + guard | M3 | done — `cli guard` + tolerances.ts (commit 1eed1d9); `oracle.yml` measure+fix jobs + PR-guard in ci.yml. Awaiting human: `oracle` env + secrets, then validate the scheduled run | — |
| WS-3.3 Observability | M3 | done — exit-code taxonomy, report step summary, `cli history` → rolling runs.ndjson artifact + summary line | — |
| WS-4.x Corpus scale-out | M4 | deferred | — |

## 15. Decisions needed (human, before the marked milestone)

- **D-1 (M2)**: Figma account for the runner (fresh dedicated account recommended; free tier suffices for paste + copy-back of own file). Provide the scratch file key + one interactive login for `figma login`. **A REST token is not needed** on the primary path — only if the Tier-2 REST pixel fallback (WS-2.5) is later enabled.
- **D-2 (M2)**: GitHub Environment `oracle` creation + the five secrets (§11); fine-grained PAT vs. GitHub App for PR opening (PAT is simpler; App gives a nicer bot identity — recommend starting with PAT).
- **D-3 (M2)**: export scale 1 (recommended default) vs. 2.
- **D-4 (M3)**: agent model + `--max-turns` budget for the scheduled fix job.
- **D-5 (M3, conditional)**: self-hosted runner if GitHub-hosted proves unable to hold Figma sessions.

## Appendix A — Repo conventions (binding for implementers)

- **Package manager**: pnpm 10, workspace protocol; `typescript` and `@types/node` via `catalog:`.
- **Lint/format**: Biome (`pnpm lint`), ultracite preset; cognitive complexity ≤ 20; no barrel files; `console` warns (CLI output in the harness should use `process.stdout/stderr` or a tiny logger, and scripts may follow the existing `console.error` pattern used by oracle scripts).
- **Types**: `pnpm check-types` (tsc noEmit) must pass; strict mode; `import type` enforced.
- **Dead code**: `pnpm knip` must stay clean — new exports need consumers or explicit knip config.
- **Tests**: Vitest. Pure logic → node project; DOM-dependent → browser project (`*.browser.test.ts`); live-Figma → gated behind `FIGMA_ORACLE_LIVE=1` and excluded from default `pnpm test`.
- **Commits**: conventional, lowercase, no scope (`feat:`, `fix:`, `chore:`); commitlint enforces. **Never add attribution lines** (repo rule in `.claude/commands/commit.md`).
- **PRs**: follow `.claude/commands/create-pr.md` (title ≤ 80 chars, TLDR ≤ 2 sentences, 1–3 bullets, no attribution footer).
- **Releases**: changesets; only published packages (`@figit/dom-to-figma`, `@figit/fig-kiwi`) get changesets — `internal/*` and `apps/*` do not.
- **Scripts**: executed via `tsx`; no build step for `internal/*` packages.
- **New dependencies**: keep the harness's deps minimal (`pixelmatch`, `pngjs`, optionally `zod`); do not add deps to published packages for pipeline needs.
