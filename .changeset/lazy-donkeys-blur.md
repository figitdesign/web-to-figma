---
"@figit/dom-to-figma": patch
---

Scale `filter: blur()` and `backdrop-filter: blur()` to Figma's blur radius
instead of passing the CSS length straight through. CSS `blur(<length>)` is a
Gaussian whose *standard deviation* is the length, while Figma's blur `radius`
is twice that sigma — so every blurred element rendered half as soft as the
browser. Measured on the new `fx/fx-07-filter-blur` scene, the 10–90% edge
falloff for `blur(6px)` was 14px in Chrome against 7px in Figma; doubling the
radius brings the tier-2 pixel diff from 7.8% to 0.
