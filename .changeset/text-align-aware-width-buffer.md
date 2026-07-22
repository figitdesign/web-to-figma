---
"@figit/dom-to-figma": patch
---

Fix the horizontal position of non-centered text. The width buffer that absorbs
browser/OpenType.js measurement differences was split evenly around the text box
(`x - widthBuffer / 2`), which assumed centered text and shifted every
left-aligned run half a buffer to the left of the browser position (and
right-aligned runs half a buffer right). The buffer now goes on the edge the
text grows away from — trailing for left, split for center, leading for right —
so the glyph origin lands where the browser put it. The box keeps its buffered
width (load-bearing: it stops Figma re-wrapping the fixed-width box). Confirmed
against Figma, which previously normalized our shifted boxes back on paste (a
tier-1 round-trip mismatch) and now round-trips them losslessly; on the local
corpus this clears every `geometry.x` text finding (e.g. `text-in-box` 28 → 14).
