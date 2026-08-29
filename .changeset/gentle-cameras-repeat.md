---
"@figit/dom-to-figma": patch
---

Bake page-side image enlargements into the bitmap so Figma paints them 1:1
instead of rescaling with its own filter, and keep a broken `<img>` in the tree
with the browser's placeholder outline rather than dropping the node.
