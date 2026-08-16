# Test untested converter fidelity hypotheses — and fix what breaks

Take a batch of hypotheses from
[`docs/oracle-hypotheses.md`](../../docs/oracle-hypotheses.md) that have no scene
yet, build their scenes, find out whether the converter actually handles them,
and **fix the ones it gets wrong**. You are invoked unattended on a schedule —
no human will answer questions, and you do not commit, push, or open PRs. Leave
everything in the working tree.

This is the front half of the lifecycle that doc describes: *new hypothesis →
scene → first run baselines it (often broken) → agent fixes it → ratchet keeps
it fixed forever.* Most of the catalog is unproven, so the expected outcome is a
mix of "confirmed, now locked in by the ratchet" and "found a real bug, fixed
it, and the ratchet now holds the fix".

## Input

One or more hypothesis IDs (passed as arguments), e.g. `BORD-15 BORD-16 CLIP-03`.
Each row in `docs/oracle-hypotheses.md` gives the priority, the tier that can
catch it, and the feature description. Drive the harness with
`pnpm --filter @figit/oracle-harness run cli <cmd>`.

Skip any ID whose row already has a `· scene:` suffix — it is already covered.
If that leaves nothing, say so and stop.

## 1. Group the batch into scenes

Write the **fewest scenes that still isolate each feature**. Two hypotheses may
share one scene when they are from the same domain and occupy *spatially
disjoint* regions — the pixel oracle reports findings per region, so two boxes
side by side stay independently attributable. Put them in separate scenes when
either feature would overlap, restyle, or inherit into the other.

Scenes live at
`packages/dom-to-figma/scripts/oracle-scenes/<domain>/<id>-<slug>.html`,
following the naming already there (`bord/bord-06-dotted`,
`bg/bg-02-linear-two-stop`). Read a few before writing yours and match their
shape.

Keep every scene tight — one feature per region, ~30 lines of HTML at most. The
smaller the scene, the larger the share of its pixels the feature owns, so a
real defect ranks as a strong finding instead of drowning in a busy layout. That
property is the whole reason the corpus is built from minimal scenes; batching
must not dilute it. A scene carrying two features is fine. A scene carrying six
is a busy layout, and its findings are worthless.

Register each scene by appending `· scene: <domain>/<id>-<slug>` to every
hypothesis row it covers, matching the existing rows.

## 2. Measure — tier-2 is the verdict

Use one run id for this first measurement and remember it; it becomes the
montage's **Before**.

```
cli snapshot  --run-id <before>
cli figma run --run-id <before> --scene <each new scene>
cli report    --run-id <before>
```

Snapshot the **whole corpus** into that run id even though only the new scenes
need Figma — `check --update` rewrites the baseline from the run it is given,
and a run missing the other scenes drops them.

**The pixel diff is the accurate test.** Tier-0 compares structure only, so a
scene can be tier-0 clean and still render visibly wrong in Figma — most rows in
the catalog are tagged `T2` for exactly that reason. Never conclude "the
hypothesis holds" from a clean tier-0 alone; each scene must have gone through a
real Figma run and come back with a tier-2 `diffRatio` you have actually read.

If `figma run` fails or a captured PNG is empty, **stop and report that** — the
measurement did not happen. A missing tier-2 result is not a pass.

## 3. Fix what is broken

For every scene whose `diffRatio` is above the noise floor, you are expected to
**fix the converter**, not to record the defect and move on. Attribute the diff
first — read the `diff/*.png`, `figma/*.png` and `ground-truth/*.png` — then fix
the cause.

**"It belongs to a pre-existing finding class" is not a reason to skip.** That
class is precisely the fix target; it is open because nobody has fixed it yet.
Check `internal/oracle-harness/known-findings/<class>.md` for its **Attempts**
section so you do not repeat a failed approach, and then attempt it. A run that
measures a discrepancy and baselines it unfixed has spent a night to make the
ratchet enshrine a bug.

The fix goes in `packages/dom-to-figma/src/` (or `packages/fig-kiwi/src/` if it
is genuinely encoding-level). Match the surrounding idioms. Iterate
tightest-loop-first: targeted unit tests → `cli snapshot --scene <yours>` →
re-run `cli figma run` for the scene and confirm the diffRatio actually drops.
Add a changeset (`patch`) for any published package you changed.

If a fix will not converge after a bounded effort, stop thrashing: revert the
converter edits, record it with
`cli ledger attempt --class <c> --what "<what you tried>" --why "<why it failed>"`,
and baseline the honest number. A newly-measured bug with a scene proving it is
still a real contribution — but it must be a *deliberate* outcome, not the
default one.

## 4. Re-measure and baseline

After fixing, measure again into a **second** run id — this is the montage's
**After** — then baseline from it:

```
cli snapshot  --run-id <after>
cli figma run --run-id <after> --scene <each new or changed scene>
cli report    --run-id <after>
cli check     --run-id <after> --update
```

If you fixed nothing, the before run is also the after run and one
`check --update` against it is enough.

Verify with `git diff` that the baseline gained only your scenes and any entry
your fix legitimately improved — no unrelated entry may move.

## 5. Hand off to the wrapper

Write `oracle/nightly-result.json` (gitignored, so it never reaches the PR). The
wrapper reads it to write the PR body and publish the before/after montage, so
prose alone is not enough:

```json
{
  "scenes": [
    {
      "id": "bord/bord-15-transparent",
      "hypotheses": ["BORD-15"],
      "beforeRunId": "<before>",
      "afterRunId": "<after>",
      "diffBefore": 0.0123,
      "diffAfter": 0,
      "verdict": "fixed",
      "note": "one line: what was wrong and what fixed it"
    }
  ],
  "changedPackages": ["@figit/dom-to-figma"]
}
```

`verdict` is `confirmed` (clean first time), `fixed` (was broken, now clean or
materially better), or `unfixed` (measured, attempted, still broken). Use the
same run id for `beforeRunId` and `afterRunId` when nothing was fixed.

## 6. Hard constraints

- **Never touch tolerances, severity constants, or the ratchet**
  (`internal/oracle-harness/src/tolerances.ts`, `severity.ts`, `scoreboard.ts`)
  to make a number look better. Fixing the converter is the only allowed way.
- **Do not edit unrelated scenes or baseline entries** beyond the deliberate
  `check --update`.
- **Do not delete a scene to make a run look clean.**
- `pnpm oracle:parity` must still pass over the whole corpus when you finish —
  new coverage must never come at the cost of a previously passing scene.

## 7. Finish

1. Full gate: `pnpm lint && pnpm check-types && pnpm build && pnpm test && pnpm oracle:parity`.
2. Leave everything **uncommitted**.
3. Summarize per hypothesis: what it claims, the scene, the tier-2 diffRatio
   before → after, and whether it was confirmed, fixed, or left unfixed.
