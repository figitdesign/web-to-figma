---
"@figit/dom-to-figma": patch
---

Honour SVG `clip-path` and paint `<text>` with its `fill`.

A shape carrying `clip-path="url(#…)"` was emitted unclipped, so a clipped
rectangle rendered at its full size in Figma (16.6% pixel diff on the new
`svg/svg-10-clip-path` scene). It now becomes a clipping frame sized to the
clip shape's bounding box; a non-rectangular clip additionally gets an outline
mask cut from the clip shape, which the frame's rectangular clip bounds. Clips
outside the modelled subset — multiple shapes, `objectBoundingBox` units,
transforms, rotated CTMs — still fall back to unclipped rather than guessing.
`<clipPath>` and `<mask>` are also properly skipped now: the tag check compared
a lower-cased tag name against `"clipPath"`, so it never matched.

SVG `<text>` took its colour from CSS `color` (black unless the document sets
it) rather than `fill`, and was laid out with a 1.2×font-size line box that
SVG text does not have, dropping the baseline 2px. Both are fixed; the new
`svg/svg-08-text` scene goes from 1.05% to 0.48%, the remainder being the
corpus-wide Arial advance-width difference between Chrome and Figma.
