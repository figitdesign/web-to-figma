# Test an untested converter fidelity hypothesis

Take one hypothesis from [`docs/oracle-hypotheses.md`](../../docs/oracle-hypotheses.md)
that has no scene yet, build its scene, and find out whether the converter
actually handles it. One hypothesis per run. You are invoked unattended on a
schedule — no human will answer questions, and you do not commit, push, or open
PRs. Leave everything in the working tree.

This is the front half of the lifecycle that doc describes: *new hypothesis →
scene → first run baselines it (often broken) → agent fixes it → ratchet keeps
it fixed forever.* Most of the catalog is unproven, so the expected outcome is
either "confirmed, now locked in by the ratchet" or "found a real bug".

## Input

A hypothesis ID (passed as the argument), e.g. `BORD-09`. Its row in
`docs/oracle-hypotheses.md` gives the priority, the tier that can catch it, and
the feature description. Drive the harness with
`pnpm --filter @figit/oracle-harness run cli <cmd>`.

Stop immediately if the row already has a `· scene:` suffix — it is already
covered, and re-testing it is not this run's job.

## 1. Write the scene

Create `packages/dom-to-figma/scripts/oracle-scenes/<domain>/<id>-<slug>.html`,
following the naming of the scenes already there (`bord/bord-06-dotted`,
`bg/bg-02-linear-two-stop`).

The scene must **isolate exactly one feature**. Read a few existing scenes first
and match their shape. Keep it to ~20 lines of HTML: the smaller the scene, the
larger the share of its pixels the feature owns, so a real defect ranks as a
strong finding instead of drowning in a busy layout. That property is the whole
reason the corpus is built from minimal scenes.

Then register it by appending `· scene: <domain>/<id>-<slug>` to that
hypothesis's row in `docs/oracle-hypotheses.md`, matching the existing rows.

## 2. Measure it — tier-2 is the verdict

```
cli snapshot  --run-id <run> --scene <domain>/<id>-<slug>
cli figma run --run-id <run> --scene <domain>/<id>-<slug>
cli report    --run-id <run>
```

**The pixel diff is the accurate test.** Tier-0 compares structure only, so a
scene can be tier-0 clean and still render visibly wrong in Figma — most rows in
the catalog are tagged `T2` for exactly that reason. Never conclude "the
hypothesis holds" from a clean tier-0 alone; the scene must have gone through a
real Figma run and come back with a tier-2 `diffRatio` you have actually read.

If `figma run` fails or the captured PNG is empty, **stop and report that** —
the measurement did not happen. A missing tier-2 result is not a pass.

## 3. Decide what you found

**Clean (diffRatio at or near the noise floor):** the hypothesis is confirmed.
Baseline it with `cli check --run-id <run> --update` so the ratchet holds this
behaviour forever, and say so in your summary. Growing proven coverage is a
perfectly good outcome — do not manufacture a fix.

**Discrepancy:** you found a real converter bug. Fix it under the same rules as
`/fix-discrepancy`:

1. Fix in `packages/dom-to-figma/src/` (or `packages/fig-kiwi/src/` if it is
   genuinely encoding-level). Match the surrounding idioms.
2. Iterate: targeted unit tests → `cli snapshot --scene <yours>` →
   re-run `cli figma run` for the scene and confirm the diffRatio actually drops.
3. Re-baseline with `check --update` and add a changeset (`patch`) for any
   published package you changed.

If it will not converge, leave the scene and its honest baseline in place and
record the finding — a newly-measured bug with a scene proving it is still a
real contribution. Do not delete the scene to make the run look clean.

## 4. Hard constraints

- **One hypothesis per run.** Do not opportunistically scene others.
- **Never touch tolerances, severity constants, or the ratchet**
  (`internal/oracle-harness/src/tolerances.ts`, `severity.ts`, `scoreboard.ts`)
  to make a number look better. Fixing the converter is the only allowed way.
- **Do not edit unrelated scenes or baseline entries** beyond the deliberate
  `check --update` for your scene.
- `pnpm oracle:parity` must still pass over the whole corpus when you finish —
  new coverage must never come at the cost of a previously passing scene.

## 5. Finish

1. Full gate: `pnpm lint && pnpm check-types && pnpm build && pnpm test && pnpm oracle:parity`.
2. Leave everything **uncommitted**.
3. Summarize: the hypothesis ID and what it claims, the scene you wrote, the
   tier-2 diffRatio you measured, whether it was confirmed or a bug was found,
   and — if you fixed something — the diffRatio before → after.
