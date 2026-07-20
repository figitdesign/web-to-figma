#!/usr/bin/env bash
#
# Refresh the Figma login the scheduled Oracle workflow uses: sign in locally
# (a browser opens once), then push the new session straight to the `oracle`
# GitHub Environment secret via gh. The session is a live credential — this
# script never prints it, and it never enters git (.figma-storage-state.json is
# gitignored).
#
# Usage:  pnpm oracle:refresh-figma            # env defaults to `oracle`
#         ORACLE_ENV=staging pnpm oracle:refresh-figma
set -euo pipefail

ENV_NAME="${ORACLE_ENV:-oracle}"
STATE_FILE="${ORACLE_STATE_FILE:-.figma-storage-state.json}"

command -v gh >/dev/null 2>&1 || {
  echo "error: gh (GitHub CLI) is not installed — see https://cli.github.com" >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo "error: not logged in to gh — run \`gh auth login\` first." >&2
  exit 1
}

echo "→ Opening Figma to sign in (a browser will open; log in, then come back)…"
pnpm --filter @figit/oracle-harness cli figma login

[ -f "$STATE_FILE" ] || {
  echo "error: $STATE_FILE was not created — the login did not complete." >&2
  exit 1
}

echo "→ Pushing the session to the '$ENV_NAME' environment secret FIGMA_STORAGE_STATE…"
base64 < "$STATE_FILE" | gh secret set FIGMA_STORAGE_STATE --env "$ENV_NAME"

echo "✓ FIGMA_STORAGE_STATE updated in the '$ENV_NAME' environment."
echo "  Verify with: Actions → Oracle → Run workflow."
