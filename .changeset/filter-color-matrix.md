---
"@figit/dom-to-figma": patch
---

Bake CSS color-matrix filters (`grayscale`/`brightness`/`contrast`/`invert`/`sepia`/`saturate`) into the Figma fill color. Figma has no color-filter effect, so these were dropped and solid elements rendered in their original, unfiltered color. They are now pre-computed into the fill when the element's whole appearance is that one solid fill — a leaf with no children, text, background-image, or border — the case that is exactly representable. Containers, images, gradients, and text with color filters stay unfiltered (they'd need the filter applied across the subtree, which Figma can't express); `hue-rotate`/`opacity` are not baked. `blur`/`drop-shadow` filters are unaffected — they remain Figma effects.
