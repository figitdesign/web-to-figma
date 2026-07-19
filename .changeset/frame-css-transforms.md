---
"@figit/dom-to-figma": patch
---

Preserve CSS `transform` (rotate/skew/scale) on frame elements. Previously these
were flattened to their axis-aligned bounding box; now the node keeps its
untransformed size and carries a Figma matrix derived from the computed
transform (assuming the default `transform-origin: center`).
