#!/usr/bin/env bash
# Publish a DOM→Figma before/after montage for a parity-fix PR — the single
# command a human (or the /fix-discrepancy agent) runs after a fix lands.
#
#   scripts/publish-montage.sh <pr-number> <scene-id> <before-run-id> <after-run-id> [title]
#
# It renders the Target/Before/After strip (`cli montage`), commits the PNG to
# the public orphan `parity-shots` hosting branch via a throwaway worktree (the
# repo is public, so a raw.githubusercontent.com URL renders inline in the PR),
# and prepends a marked montage block to the PR body — idempotently, so
# re-running replaces the block instead of stacking duplicates.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -lt 4 ]; then
  echo "usage: scripts/publish-montage.sh <pr-number> <scene-id> <before-run-id> <after-run-id> [title]" >&2
  exit 1
fi

PR="$1"
SCENE="$2"
BEFORE="$3"
AFTER="$4"
TITLE="${5:-$SCENE}"
# Stable, filesystem- and URL-safe asset name (bord/bord-03 -> bord-bord-03).
NAME="${SCENE//\//-}"
PNG="/tmp/$NAME.png"

cli() {
  pnpm --silent --filter @figit/oracle-harness run cli "$@"
}

# A stale, invalid GH_TOKEN env var can override the keyring login on this
# machine; when `gh auth status` fails, retry with GH_TOKEN unset.
ghc() {
  if gh auth status >/dev/null 2>&1; then
    gh "$@"
  else
    env -u GH_TOKEN gh "$@"
  fi
}

# ── 1. Render the montage ──────────────────────────────────────────────────
echo "▶ rendering montage for $SCENE → $PNG"
cli montage --scene "$SCENE" --before "$BEFORE" --after "$AFTER" \
  --title "$TITLE" --out "$PNG"

# ── 2. Publish the PNG to the orphan `parity-shots` branch ─────────────────
# Use a throwaway worktree so the current checkout is never disturbed.
TMP="$(mktemp -d)"
WT="$TMP/parity-shots"
cleanup() {
  git worktree remove --force "$WT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git fetch origin
if git ls-remote --exit-code --heads origin parity-shots >/dev/null 2>&1; then
  git worktree add "$WT" origin/parity-shots
else
  git worktree add --orphan -b parity-shots "$WT"
fi

cp "$PNG" "$WT/$NAME.png"
git -C "$WT" add "$NAME.png"
if git -C "$WT" diff --cached --quiet; then
  echo "▶ montage bytes unchanged — skipping commit/push"
else
  git -C "$WT" commit -m "chore: montage for PR #$PR ($SCENE)"
  git -C "$WT" push origin HEAD:parity-shots
fi

# ── 3. Embed the raw image in the PR body (idempotent) ─────────────────────
REPO="$(ghc repo view --json nameWithOwner -q .nameWithOwner)"
RAW="https://raw.githubusercontent.com/$REPO/parity-shots/$NAME.png"

BODY="$(ghc pr view "$PR" --json body -q .body)"
# Scope the marker to the scene: a batch run publishes one montage per scene,
# and a shared marker would make each one delete the last.
OPEN="<!-- parity-montage:$NAME -->"
CLOSE="<!-- /parity-montage:$NAME -->"
# Drop only this scene's prior block (marker comments included) so re-running
# replaces it in place and leaves its siblings alone.
STRIPPED="$(printf '%s\n' "$BODY" | awk -v o="$OPEN" -v c="$CLOSE" '
  index($0, o) {inblock=1}
  inblock==0 {print}
  index($0, c) {inblock=0}
')"

TMPBODY="$TMP/body.md"
{
  printf '%s\n' "$OPEN"
  printf '### DOM→Figma parity — `%s`\n\n' "$SCENE"
  printf '![parity montage for %s](%s)\n' "$SCENE" "$RAW"
  printf '%s\n\n' "$CLOSE"
  printf '%s\n' "$STRIPPED"
} >"$TMPBODY"
ghc pr edit "$PR" --body-file "$TMPBODY"

echo "$RAW"
echo "✓ montage published and embedded in PR #$PR"
