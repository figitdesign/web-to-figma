---
"@figit/dom-to-figma": patch
---

Render CSS radial gradients, angled linear gradients, and `object-fit` faithfully.

- `radial-gradient(…)` produced no paint at all, leaving the element blank. It now
  converts to a Figma radial paint.
- Angled linear gradients were mirrored: the transform's horizontal term carried
  the wrong sign, which cancelled out at 0deg/180deg and so went unnoticed. The
  gradient line is now also scaled to the element's box, so the end stops land on
  the same corners the browser uses.
- `object-fit` was ignored and every image was pasted with Figma's `FILL` (cover).
  `fill`, `cover`, and `contain` now map to `STRETCH`, `FILL`, and `FIT`.
