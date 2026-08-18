---
"@figit/dom-to-figma": patch
---

Ship the browser's measured box for text nodes and content-sized elements
instead of an inflated one. Text sizes were padded twice — `ceil(width) + 1`
when measuring, then a further weight-keyed width buffer when building the node
— and element frames were rounded up with `Math.ceil`, so every text run was up
to 4px wider than the DOM laid it out and every content-sized box up to 1px
wider. On a bordered inline element the padding pushed the text past the
parent's content box and displaced the right border edge.

The slack that absorbs Figma remeasuring a run wider than the browser did is
still applied, but only where it does any work: the line-breaking container
width. The node's own size, which is transparent and no longer drives wrapping,
now carries the measured geometry. Block boxes are unaffected — CSS already
gives them integer widths, so the rounding only ever bit the text-driven
fractional case.
