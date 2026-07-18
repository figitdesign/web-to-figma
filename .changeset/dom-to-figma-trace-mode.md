---
"@figit/dom-to-figma": minor
---

Add opt-in `trace` mode. `createFigmaConverter({ trace: true })` returns a `ConvertTrace` on the result, mapping every emitted Figma node GUID back to its source DOM element (`domPath`, `rect`, `kind`, `tag`, `text`). It is off by default, adds no cost when disabled, and does not change the payload bytes.
