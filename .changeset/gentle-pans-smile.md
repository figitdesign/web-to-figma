---
"@figit/dom-to-figma": patch
---

Cut SVG `stroke-dasharray` into explicit dash geometry so dashes land where SVG
puts them. Figma re-fits a node's `dashPattern` to each segment of the vector
network — stretching the period to a whole number of repeats and centring a dash
on every vertex — which left a 12/8 dash on a 70×80 rect running 10.5/7 along its
70px sides, half a period out of phase. Shapes with no fill now carry one open
subpath per dash instead, with `dashPattern` cleared; `stroke-dashoffset` is
honoured too.
