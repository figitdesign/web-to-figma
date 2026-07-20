#!/usr/bin/env bash
# The end-to-end parity loop, run locally by a human. This is the same
# measure → fix orchestration the removed GitHub Actions workflow ran, kept
# out of CI by decision (docs/visual-parity-pipeline.prd.md §9): the human
# triggers it, watches it, and reviews the uncommitted result.
#
#   pnpm oracle:loop
#
# Tunables (env): ORACLE_RUN_ID, ORACLE_AGENT_MODEL (default claude-opus-4-8),
# ORACLE_MAX_TURNS (default 80).
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_ID="${ORACLE_RUN_ID:-$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)}"
MODEL="${ORACLE_AGENT_MODEL:-claude-opus-4-8}"
MAX_TURNS="${ORACLE_MAX_TURNS:-80}"

cli() {
  pnpm --silent --filter @figit/oracle-harness run cli "$@"
}

echo "▶ oracle loop — run $RUN_ID"

# ── Measure (Tiers 0–2 against real Figma) ─────────────────────────────────
# validate fails fast with exit 3 when the stored login expired (re-run
# `cli figma login`), so an auth problem never reads as a parity regression.
cli figma validate
cli snapshot --run-id "$RUN_ID"
cli figma run --run-id "$RUN_ID"
cli report --run-id "$RUN_ID" --commit "$(git rev-parse HEAD)"
cli ledger reconcile --run-id "$RUN_ID"
cli history --run-id "$RUN_ID"

# ── Select (via the ledger, which skips parked/cooled-down classes) ────────
CLASS=$(cli ledger select --run-id "$RUN_ID" | tail -n1 | tr -d '[:space:]')
if [ -z "$CLASS" ] || [ "$CLASS" = "none" ]; then
  echo "✓ nothing workable to fix this run — loop complete"
  exit 0
fi

# ── Fix (the agent edits; it never commits, pushes, or opens PRs) ──────────
echo "▶ fix agent on class: $CLASS (model $MODEL, max $MAX_TURNS turns)"
claude -p "/fix-discrepancy oracle/runs/$RUN_ID/report.json" \
  --permission-mode acceptEdits \
  --max-turns "$MAX_TURNS" \
  --model "$MODEL"

# ── Verify (the whole tier-0 corpus must still hold the ratchet) ───────────
echo "▶ verifying the tier-0 ratchet after the fix"
pnpm oracle:parity

echo
echo "Loop complete. Review the working tree and commit what you accept:"
git status --short
