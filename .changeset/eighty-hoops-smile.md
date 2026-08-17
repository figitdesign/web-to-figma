---
"@figit/dom-to-figma": patch
---

Draw CSS `outline` and paint dashed/dotted borders as fitted geometry.

An `outline` was dropped entirely: a Figma node's single stroke already belongs
to the border and hugs the box, so it cannot stand off by `outline-offset`. The
ring now becomes its own oversized child frame whose INSIDE stroke lands exactly
where CSS paints it, following the border radius as CSS does.

Dashed and dotted borders were drawn solid, or with one dash pattern phased
continuously around the whole box, because Figma carries a single pattern per
node. Chrome instead fits the dashes to each side, landing one in every corner,
so the two drifted out of step. Each side's dashes are now painted as their own
geometry using Chrome's fit — the dash fixed at twice the border width, the
count chosen so the resulting gap comes closest to its nominal width — which
also lets a border mix `solid`, `dashed`, `dotted` and `double` sides. A rounded
box is fitted as one loop instead, its dashes cut into bands across the straight
runs and arc sectors around the corners.
