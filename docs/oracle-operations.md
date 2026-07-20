# Oracle pipeline — operations runbook

How to turn on the scheduled DOM→Figma parity pipeline (`.github/workflows/oracle.yml`),
test it end to end, and keep it running. For the design, see
[`visual-parity-pipeline.prd.md`](./visual-parity-pipeline.prd.md).

## 1. One-time setup — the `oracle` environment

Create a GitHub **Environment** named `oracle`
(_repo → Settings → Environments → New environment_) and add these four secrets to
it. The scheduled workflow reads them; PR-facing jobs never can.

| Secret | What it is | How to generate |
| --- | --- | --- |
| `FIGMA_STORAGE_STATE` | The Figma login session (a credential), base64-encoded | **`pnpm oracle:refresh-figma`** — signs you in locally and pushes the session straight to the secret via `gh` (needs `gh auth login` once + repo admin). Manual alternative: `cli figma login` → `base64 < .figma-storage-state.json \| pbcopy` → paste. |
| `FIGMA_FILE_KEY` | The scratch Figma file's key | Copy from the file URL: `figma.com/file/<THIS>/…` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your Claude subscription token (no API bill) | `claude setup-token` locally → copy the printed token. _To use the metered API instead, store `ANTHROPIC_API_KEY` and swap the one line noted in `oracle.yml`._ |
| `ORACLE_GH_TOKEN` | Fine-grained PAT so the agent can open PRs that trigger CI | _github.com → Settings → Developer settings → Fine-grained tokens._ Scope: **this repo only**, permissions **Contents: Read/write** + **Pull requests: Read/write**. Set an expiry (e.g. 90d) and calendar a renewal. |

> **Never** paste any of these into chat, a commit, or an issue. `.figma-storage-state.json`
> is gitignored and is a full login — treat it like a password.

## 2. Test it, smallest scope first

Run these in order; each proves more of the loop. Stop and fix if one fails.

1. **Tier-0, no credentials (local):**
   ```
   pnpm oracle:parity
   ```
   Renders the corpus, runs the structural diff, checks the ratchet. Proves the
   measurement half works. Safe to run anytime — it's the same job every PR runs.

2. **The agent, locally (the drill):** hand the fixer a real report and watch it
   work, without the cloud:
   ```
   pnpm --filter @figit/oracle-harness cli snapshot --run-id drill
   pnpm --filter @figit/oracle-harness cli report   --run-id drill
   claude "/fix-discrepancy oracle/runs/drill/report.json"
   ```
   Confirm it selects a class, writes a repro scene, edits the converter, and
   opens (or would open) a labelled PR. This is the acceptance test for the agent
   and needs no secrets.

3. **The full cloud loop (manual trigger):** once the secrets are in, go to
   _Actions → Oracle → Run workflow_ (this is `workflow_dispatch`). Watch:
   - **measure** produces a run artifact + a step-summary line,
   - **fix** opens a PR labelled `oracle-fix` or `oracle-ledger`,
   - CI + the `guard` job run on that PR.
   Merge it (or not) — that's your call. Nothing reached `main` without this merge.

4. **Seeded-bug drill (highest confidence):** on a throwaway branch, deliberately
   break the converter (e.g. an off-by-one in geometry), run the workflow, and
   confirm the agent produces a PR that _fixes exactly that_ and passes the guard.
   Revert the branch. This proves the whole loop catches and repairs a real bug.

Only after 3–4 pass should you leave the daily `schedule` on.

## 3. How you're notified when something breaks

Two layers:

- **Automatic email:** GitHub emails you when a scheduled run fails (it goes to
  whoever last edited the workflow file — make sure that's you).
- **A tracked, actionable issue:** the workflow's `alert` job opens **one**
  deduplicated issue labelled `oracle-alert` on any failure, and _comments_ on it
  for repeat failures instead of spamming new ones. When the failure is a
  credential expiry, the issue names which one and the exact command to fix it.

Watch the repo (or the `oracle-alert` label) so those issues reach your inbox.

## 4. When a credential expires — what to do

| Symptom | Fix |
| --- | --- |
| `oracle-alert` issue says **Figma session expired** (measure job, exit 3) | `pnpm oracle:refresh-figma` (re-login + push in one step) → re-run the workflow |
| `oracle-alert` issue says **Claude token expired** (fix job auth error) | `claude setup-token` → update the `CLAUDE_CODE_OAUTH_TOKEN` secret → re-run |
| PRs stop appearing / push denied | The `ORACLE_GH_TOKEN` PAT expired — regenerate it with the same scopes and update the secret |

Rough cadence: the **Figma session** lasts weeks (the most frequent refresh); the
**Claude token** and **GitHub PAT** are long-lived but do expire — set a PAT expiry
you'll remember, or the alert will tell you when it lapses. None of these auto-refresh
by design: they're live credentials, so a human rotates them.

## 5. Cost & spend controls

- Claude usage bills against your **subscription quota** (shared with your own
  interactive Claude Code). One class per run, once daily, bounded by `--max-turns`.
  If the bot starts eating your quota, swap to `ANTHROPIC_API_KEY` (metered) — a
  one-line change in `oracle.yml`.
- GitHub Actions minutes are consumed by the runners; the `concurrency` group
  prevents overlapping runs. Raise cadence by adding `cron` entries only after the
  loop is proven stable.
