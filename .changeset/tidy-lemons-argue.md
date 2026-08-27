---
"@figit/dom-to-figma": patch
---

Carry `text-decoration` style, colour and thickness through to Figma, and
resolve logical `text-align` against the inline direction.

Only the decoration *line* survived conversion before: `text-decoration:
underline wavy #dc2626` reached Figma as a hairline black rule, and so did a
dotted green 3px one. Figma paints the rectangles we ship in
`derivedTextData.decorations` and styles them from the node's
`textDecorationStyle` / `textDecorationFillPaints` fields, so the fix is both —
emit the fields, and size the rectangle from the resolved CSS thickness instead
of a fixed `fontSize * 0.028`. On the new `txt/txt-08-decoration-style` scene
that takes the tier-2 pixel diff from 3.7% to 2.8%, with the wave, the dots and
the 4px rule all rendering. CSS `dashed` maps to Figma's `DOTTED`, the nearest
broken line it has; `double` stays solid.

Separately, `text-align` computes to the logical keyword `start` on any element
that never set it, and the converter only knew the physical keywords — so it
fell through to `LEFT` and every `direction: rtl` paragraph rendered flush
against the wrong edge. `start`/`end` now resolve against the element's
direction, and an RTL paragraph also ships `sourceDirectionality: RTL` and an
`RTL` derived line instead of claiming `AUTO`/`LTR`. New `txt/txt-17-rtl` scene,
2.1% to 1.9%, with the text now on the correct side.
