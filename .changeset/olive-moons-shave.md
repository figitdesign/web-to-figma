---
"@figit/dom-to-figma": patch
---

Render a uniform CSS `dotted` border as a Figma dashed stroke instead of a solid
line. Dots take the border width with an equal gap, matching Chrome's raster.
`dashed` stays solid on purpose: Figma runs one dash pattern around the whole
path while Chrome fits dashes to each side, so a dashed pattern drifts out of
phase and measures worse than a solid line.
