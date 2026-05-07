---
"@sleekdesign/dom-to-figma": patch
---

Preserve cutouts in SVG compound paths when converting to Figma. Subpaths inside a single `<path>` element are now merged into one Figma vector region with multiple loops, and the encoder's winding-rule bit was flipped to match Figma's actual format. Outline icons (e.g. Phosphor speech bubbles, circle-plus icons with `fill-rule="evenodd"`) now render with their inner holes instead of as solid silhouettes.
