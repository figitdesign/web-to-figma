---
"@figit/dom-to-figma": patch
---

A colour value colorjs cannot parse, such as an SVG paint-server reference (`fill="url(#gradient)"`) or `context-fill`, now gives no solid paint instead of throwing. The throw dropped the whole layer, so a shape filled by a gradient lost its stroke and outline too.
