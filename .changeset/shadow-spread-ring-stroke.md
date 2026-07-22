---
"@figit/dom-to-figma": patch
---

Render pure-ring box-shadows (`0 0 0 <spread>`) as an OUTSIDE stroke. Figma does
not draw a zero-offset, zero-blur, positive-spread `DROP_SHADOW`, so a CSS ring
was disappearing. Such shadows now become an OUTSIDE frame stroke whose weight is
the spread and whose paint is the shadow color, so the ring follows the corner
radius and no longer changes the node size. Shadows with any blur or offset stay
`DROP_SHADOW`, and elements with a real CSS border keep their border stroke (the
ring falls back to the drop-shadow effect there).
