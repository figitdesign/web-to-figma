---
"@figit/fig-kiwi": minor
---

Export `diffFigmaTrees`, `Mismatch`, `treeOrder`, and `OracleNode` for
structural diffing of decoded Figma payloads. This is the comparison the oracle
tooling uses to check a sent payload against Figma's copy-back, now shared so
the visual-parity harness can consume it too.
