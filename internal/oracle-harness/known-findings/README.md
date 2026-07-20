# Findings ledger

The cross-run memory of discrepancy classes: one `<class>.md` file per class
(e.g. `text.lineHeight.md`), committed and reviewed like code. Frontmatter
carries machine-read fields; the body accumulates the human-read narrative
(Analysis / Attempts / Verdict) across runs.

**Ledger schema version: 1.**

See [`docs/visual-parity-pipeline.prd.md` §6.5](../../../docs/visual-parity-pipeline.prd.md)
for the field reference and lifecycle. In short:

- `open` — eligible for fix work, ranked by severity.
- `attempting` — mid-attempt within a run (a crash marker).
- `parked` — excluded from fix work; its magnitude is accepted into the
  scoreboard so the ratchet doesn't block other fixes. Only a human un-parks it.
- `resolved` — findings dropped to zero; the file is deleted (git keeps history).

Managed via the harness CLI: `ledger reconcile | select | status | park |
attempt`. `.run-counter` holds the monotonic run counter used for cooldowns.
Reconciliation runs only when you drive a full local run; the PR parity job
never mutates this directory.
