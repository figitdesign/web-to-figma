---
"@figit/dom-to-figma": patch
---

Preserve CSS `transform` (rotate/skew/scale) on leaf frame elements. Previously
these were flattened to their axis-aligned bounding box; now the node keeps its
untransformed size and carries a Figma matrix derived from the computed
transform (assuming the default `transform-origin: center`). Transformed
elements with children keep the flattened-bbox behavior for now: in Figma the
matrix would apply to the whole subtree while descendants are still measured in
transformed screen space, so a parent matrix would transform them twice.
