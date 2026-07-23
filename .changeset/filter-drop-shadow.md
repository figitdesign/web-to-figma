---
"@figit/dom-to-figma": patch
---

Render CSS `filter: drop-shadow()` as a Figma drop shadow. Previously only `filter: blur()` was handled, so `drop-shadow()` was dropped and the element rendered flat. Each `drop-shadow()` in the filter now maps to a `DROP_SHADOW` effect — parsed paren-aware so nested `rgba()`/`hsl()` colors survive — sharing the `text-shadow` parser since both are offset+blur+color shadows with no `inset` or spread. `blur()` handling is unchanged; color-matrix filters (`grayscale`/`brightness`/`contrast`) remain unsupported (no Figma equivalent).
