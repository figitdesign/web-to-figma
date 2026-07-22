# Oracle pipeline — operations runbook

How to run the DOM→Figma parity pipeline locally, end to end. The pipeline is
deliberately local-only: a human drives every run and reviews every change
before it is committed. For the design, see
[`visual-parity-pipeline.prd.md`](./visual-parity-pipeline.prd.md).

## 1. One-time setup — credentials

Everything lives in a local `.env` (see `.env.example`); nothing is stored in
CI or shared anywhere.

| Value | What it is | How to generate |
| --- | --- | --- |
| `FIGMA_STORAGE_STATE` | The Figma login session (a credential): a path to a gitignored file | `pnpm --filter @figit/oracle-harness cli figma login` — opens a browser, waits for you to sign in once, writes `.figma-storage-state.json` |
| `FIGMA_FILE_KEY` | The scratch Figma file's key | Copy from the file URL: `figma.com/file/<THIS>/…` |
| `FIGMA_TOKEN` | Optional — only the Tier-2 REST pixel fallback reads it | Figma → account settings → personal access token (`file_read` scope) |

> **Never** paste any of these into chat, a commit, or an issue.
> `.figma-storage-state.json` is gitignored and is a full login — treat it like
> a password.

## 2. The loop — one command

```
pnpm oracle:loop
```

Runs the whole thing end to end (`scripts/oracle-loop.sh`): validate the Figma
session → snapshot (Tier 0) → drive Figma (Tiers 1–2) → report + reconcile the
ledger + append history → select the top workable class → run the
`/fix-discrepancy` agent on it (`claude -p`, `acceptEdits`, bounded turns) →
re-verify the tier-0 ratchet. It ends by printing the dirty working tree: you
review, then commit or discard. Tunables via env: `ORACLE_AGENT_MODEL`,
`ORACLE_MAX_TURNS`, `ORACLE_RUN_ID`.

Any step failing kills the loop loudly (`set -euo pipefail`); "nothing
workable to fix" is a successful exit.

## 3. Running the pieces individually

Useful for debugging one stage or doing a measure-only run.

1. **Tier-0, no credentials:**

   ```
   pnpm oracle:parity
   ```

   Renders the corpus, runs the structural diff, checks the ratchet. Safe to
   run anytime — it's the same job every PR runs in CI.

2. **Tiers 1–2, real Figma:**

   ```
   pnpm --filter @figit/oracle-harness cli figma validate
   pnpm --filter @figit/oracle-harness cli snapshot --run-id <id>
   pnpm --filter @figit/oracle-harness cli figma run --run-id <id>
   pnpm --filter @figit/oracle-harness cli report   --run-id <id>
   pnpm --filter @figit/oracle-harness cli ledger reconcile --run-id <id>
   ```

   `validate` fails with exit 3 when the stored login has expired — re-run
   `cli figma login`. Artifacts land under the gitignored `oracle/runs/<id>/`.

3. **The fix agent, under your supervision:** hand the fixer a real report and
   watch it work:

   ```
   claude "/fix-discrepancy oracle/runs/<id>/report.json"
   ```

   It selects one class via the ledger, writes a repro scene, edits the
   converter, and leaves everything uncommitted with a summary. You review the
   working tree, then commit (or discard) the result yourself.

4. **Record the run** (optional, for trend-watching):

   ```
   pnpm --filter @figit/oracle-harness cli history --run-id <id>
   ```

   Appends a one-line summary to the gitignored `oracle/history/runs.ndjson`.

## 4. Before/after montage for PRs

When a fix changes something **visually apparent**, attach a before/after strip
to the PR so a reviewer sees the improvement at a glance: three labelled panels
— **Target** (browser), **Before** (pre-fix Figma) and **After** (post-fix
Figma) — stitched from PNGs the pipeline already wrote under
`oracle/runs/<run>/{ground-truth,figma}/`.

One command renders, hosts, and embeds it:

```
scripts/publish-montage.sh <pr-number> <scene-id> <before-run-id> <after-run-id> [title]
```

It renders the strip, commits the PNG to the orphan **`parity-shots`** hosting
branch through a throwaway worktree (your checkout is never touched), and
prepends a marked block to the PR body. Re-running **replaces** that block
instead of duplicating it, so it is safe to run again after each iteration.

To render the strip alone — e.g. to eyeball it before publishing:

```
pnpm --filter @figit/oracle-harness cli montage \
  --scene <scene-id> --before <before-run-id> --after <after-run-id> \
  [--title <str>] [--out <path>]
```

Default `--out` is `oracle/runs/<after>/montage/<stem>.png`; the Target panel is
the after run's `ground-truth/` PNG (the browser render is
converter-independent, so either run's is fine).

**Hosting.** This repo is **public**, so the committed PNG is served straight
from the branch — embed it with a raw URL:
`https://raw.githubusercontent.com/<owner>/<repo>/parity-shots/<name>.png`
(`publish-montage.sh` writes exactly this into the PR body). For a **private**
repo those raw URLs don't render — drag-drop the PNG into the PR body instead.

**When _not_ to use one.** A montage only helps when the difference is visible.
For a sub-pixel fix (e.g. a 1px text-baseline shift) the panels look identical —
prefer numeric or round-trip evidence (the report's Δpx / diff-ratio, or a
copy-back assertion) in the PR description instead.

## 5. When a credential expires

| Symptom | Fix |
| --- | --- |
| `cli figma validate` (or any figma command) exits 3 | `cli figma login` again — the session lasts weeks |
| Tier-2 REST fallback 403s | Regenerate `FIGMA_TOKEN` |

Neither auto-refreshes by design: they're live credentials, so a human rotates
them.
