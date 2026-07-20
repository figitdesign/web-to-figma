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

## 2. Running the pipeline

Run these in order; each proves more of the loop.

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

## 3. When a credential expires

| Symptom | Fix |
| --- | --- |
| `cli figma validate` (or any figma command) exits 3 | `cli figma login` again — the session lasts weeks |
| Tier-2 REST fallback 403s | Regenerate `FIGMA_TOKEN` |

Neither auto-refreshes by design: they're live credentials, so a human rotates
them.
