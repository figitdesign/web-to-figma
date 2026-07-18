# @figit/oracle-harness

Private tooling for the visual-parity pipeline: measure how faithfully
`@figit/dom-to-figma` reproduces a DOM inside Figma, and drive autonomous fixes.
See [`docs/visual-parity-pipeline.prd.md`](../../docs/visual-parity-pipeline.prd.md)
for the full design and workstreams.

Not published. Run via `tsx`:

```sh
pnpm --filter @figit/oracle-harness run cli <command>
```

## Commands

| Command | Status | Does |
| --- | --- | --- |
| `snapshot` | stub (WS-1.3/1.4) | Render scenes, capture ground truth + payload, run the tier-0 diff. |
| `figma` | stub (WS-2.x) | Paste into Figma, capture tier-1/2 findings. |
| `report` | stub (WS-1.5/1.7) | Merge tier outputs into `report.json` and reconcile the ledger. |
| `check` | stub (WS-1.6) | Compare a run against the committed scoreboard baseline. |
| `calibrate` | stub (WS-2.6) | Measure Figma's render noise floor. |
| `guard` | stub (WS-3.2) | Enforce oracle PR path/diff rules. |

Only scene discovery and run-directory management are implemented so far
(WS-1.2 scaffold). Run artifacts land under the gitignored `oracle/runs/<runId>/`.
