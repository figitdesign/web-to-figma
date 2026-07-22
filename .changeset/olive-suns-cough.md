---
"@figit/dom-to-figma": patch
---

Render per-side border colors instead of collapsing them to one. A Figma frame
carries a single stroke color, so a box with four different solid border colors
(`border-top-color` … `border-left-color`) previously painted the whole border
with the top color. When the visible sides are all `solid` but disagree on
color, the border is now decomposed into one filled VECTOR trapezoid per side —
reproducing CSS's 45° mitered corners exactly — and the frame's own stroke is
dropped. Uniform borders (and per-side widths with a shared color) keep the
single-stroke fast path, and dashed/dotted/double sides are left untouched.
