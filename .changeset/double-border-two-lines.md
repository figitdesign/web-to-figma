---
"@figit/dom-to-figma": patch
---

Render CSS `double` borders as two concentric lines instead of one solid stroke. Figma has no native double-border style, so a uniform `border-style: double` now maps the frame's own stroke to the outer line and emits an inset stroked child frame for the inner line, letting the element background show through the gap between them (matching Chrome's 1/3–1/3–1/3 split). Solid and other border styles are unchanged.
