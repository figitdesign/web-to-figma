---
"@figit/dom-to-figma": minor
"@figit/fig-kiwi": minor
---

Infer native Figma auto-layout from the DOM.

`@figit/dom-to-figma` now converts flex, block flow, wrapping rows, and grids into real Figma auto-layout frames (`stackMode`, spacing, padding, hug/fill/stretch sizing), with absolutely positioned children carried over as absolute-positioned layers. Inference is per-container and verified against the browser's measured geometry — any container it can't reproduce exactly falls back to absolute positioning, so the result is never worse than a fixed-position paste.

**Behavior change:** auto-layout is now the default. `createFigmaConverter()` infers auto-layout out of the box; pass `layout: "absolute"` to keep the previous fixed-position behavior. This is geometrically backward-compatible (positions and sizes are preserved), but pasted frames now arrive as editable stacks instead of absolutely-positioned frames.

`@figit/fig-kiwi` gains a clipboard decoder (`decodeFigmaData`, `parseClipboardHtml`) that reads Figma's copy payloads — schema-driven via the payload's own embedded schema and handling zstd-compressed data chunks — plus shared auto-layout field metadata (`STACK_FIELD_DEFAULTS`, `TRACKED_STACK_FIELDS`).
