# Fix a DOM→Figma parity discrepancy

Pick the highest-impact converter discrepancy the parity pipeline found, fix it,
and prove the fix improved the numbers. One discrepancy **class** per run. You
are invoked locally by a human who reviews and commits the result — do not
commit, push, or open PRs yourself.

## Input

A path to a run's `report.json` (passed as the argument). If none is given, use
the most recent `oracle/runs/*/report.json`. The findings live in the harness
`@figit/oracle-harness`; drive it with `pnpm --filter @figit/oracle-harness run cli <cmd>`.

## 1. Select the target class (via the ledger, not raw severity)

Run `cli ledger select --run-id <id>`, where `<id>` is the run-id segment of
the report path (`oracle/runs/<id>/report.json`). This returns the top class
the ledger says is workable — it already skips `parked` and cooled-down classes.

- If it prints `none`, there is nothing to fix right now. Exit successfully and
  say so. Do not force a lower-priority class.
- Otherwise, that class is your target. Load its `exemplarFindingId` from the
  report, open the referenced artifacts (`diff/*.png`, `figma/*.png`,
  `ground-truth/*.png`), and read the class's ledger entry in
  `internal/oracle-harness/known-findings/<class>.md` — its **Attempts** section
  tells you what has already been tried and failed. Do not repeat those.

## 2. Reproduce before fixing

Write a **minimal** scene (≤ ~20 lines of HTML) under
`packages/dom-to-figma/scripts/oracle-scenes/` that isolates the discrepancy —
strip the exemplar scene down to the smallest DOM that still exhibits it. This
scene is the regression test; the fix is not done until this scene is clean.

- Where the class shows at tier-0 (structural), that scene alone is enough —
  `cli snapshot --scene <id>` will surface it.
- Where the class is tier-1/2-only (a Figma reinterpretation the copy-back or
  pixels catch but the payload doesn't), also add a unit test asserting the
  intended payload property, and note in your summary that full confirmation
  comes from the next Figma run.

## 3. Fix the converter

The fix goes in `packages/dom-to-figma/src/` (or `packages/fig-kiwi/src/` if it
is genuinely an encoding-level bug). Iterate tightest-loop-first:

1. Targeted unit tests for the code you changed.
2. `cli snapshot --scene <your repro> --scene <exemplar>` → tier-0 clean.
3. `pnpm oracle:parity` → the whole tier-0 corpus still passes (no regressions).

Read the existing converter code and match its idioms. The measurement is the
oracle — trust the pipeline's numbers over your intuition about whether it looks
right.

## 4. Hard constraints

- **One discrepancy class per run.** Do not opportunistically fix others.
- **Never touch the tolerances, severity constants, or the ratchet** to make a
  run pass (`internal/oracle-harness/src/tolerances.ts`, `severity.ts`,
  `scoreboard.ts` thresholds). Fixing the converter is the only allowed way to
  improve a number.
- **Do not edit unrelated scenes or the baseline** beyond the deliberate
  `check --update` that records your improvement.
- If you cannot make it converge after a bounded effort, stop and go to §6 — do
  not thrash.

## 5. Finish — success

1. Re-baseline: `cli check --run-id <run> --update` (the diff to
   `baseline/scoreboard.json` shows the improvement).
2. Mark the class resolved: `cli ledger` reconcile drops it when its findings
   hit zero; confirm it is gone from `known-findings/`.
3. Add a changeset (`patch`) for the published package you changed.
4. Run the full gate: `pnpm lint && pnpm check-types && pnpm test && pnpm knip`.
5. Leave everything uncommitted and summarize for the human: the class fixed,
   findings/diffRatio before → after, scenes affected, and the repro scene
   name. The human reviews the working tree and commits.

## 6. Finish — could not fix

Do **not** leave converter edits behind — revert them. Record the outcome in
the ledger, summarize what you learned, and stop:

- **Transient / ran out of budget** (flaky, needs more time):
  `cli ledger attempt --class <c> --what "<what you tried>" --why "<why it failed>" --cooldown <N>`.
  It stays `open` and a later run retries it, informed by your notes.
- **Genuinely unfixable in the converter, or it needs a tolerance/calibration
  decision that is the human's to make**:
  `cli ledger park --class <c> --verdict "<the decision a human must make>"`.

The ledger change stays in the working tree for the human to review and commit.

## Guardrails

- You may **not** flip a `parked` ledger entry back to `open` or edit its
  verdict — only a human does that.
- Prefer the smallest, most surgical converter change that makes the repro
  scene clean. A large refactor to fix one class is a smell.
