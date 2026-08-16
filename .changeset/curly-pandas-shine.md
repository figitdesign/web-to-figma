---
"@figit/dom-to-figma": patch
---

Render the CSS 3D border styles (`groove`, `ridge`, `inset`, `outset`) with
Chrome's bevel shading instead of a flat stroke in the declared color. Each side
is painted as a filled trapezoid — reusing the per-side-color decomposition, so
the 45° miters still match CSS — shaded by Blink's own rules: sides facing away
from the top-left light source are darkened, and `groove`/`ridge` split every
side in half and shade the halves in opposite directions. When darkening a color
would leave too little contrast to read as a bevel (dark navy, black), the lit
sides are lightened instead, as Chrome does.
