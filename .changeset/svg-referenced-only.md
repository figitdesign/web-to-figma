---
"@figit/dom-to-figma": patch
---

Skip SVG elements that are only referenced, never drawn where they stand: `clipPath`, `mask`, `symbol`, `pattern`, `marker`, `linearGradient`, `radialGradient` and `filter`. The skip list named `clipPath`, but compared it against a lowercased tag name, so it never matched: a clip path outside `<defs>` pasted as a visible shape.
