# @figit/fig-kiwi

## 0.1.0

### Minor Changes

- [#19](https://github.com/figitdesign/web-to-figma/pull/19) [`4c0c004`](https://github.com/figitdesign/web-to-figma/commit/4c0c00487b610fdfc0935f3efb5679ba60155a6c) Thanks [@niko047](https://github.com/niko047)! - Infer native Figma auto-layout from the DOM.

  `@figit/dom-to-figma` now converts flex, block flow, wrapping rows, and grids into real Figma auto-layout frames (`stackMode`, spacing, padding, hug/fill/stretch sizing), with absolutely positioned children carried over as absolute-positioned layers. Inference is per-container and verified against the browser's measured geometry — any container it can't reproduce exactly falls back to absolute positioning, so the result is never worse than a fixed-position paste.

  **Behavior change:** auto-layout is now the default. `createFigmaConverter()` infers auto-layout out of the box; pass `layout: "absolute"` to keep the previous fixed-position behavior. This is geometrically backward-compatible (positions and sizes are preserved), but pasted frames now arrive as editable stacks instead of absolutely-positioned frames.

  `@figit/fig-kiwi` gains a clipboard decoder (`decodeFigmaData`, `parseClipboardHtml`) that reads Figma's copy payloads — schema-driven via the payload's own embedded schema and handling zstd-compressed data chunks — plus shared auto-layout field metadata (`STACK_FIELD_DEFAULTS`, `TRACKED_STACK_FIELDS`).

## 0.0.2

### Patch Changes

- [#17](https://github.com/figitdesign/web-to-figma/pull/17) [`eaca85c`](https://github.com/figitdesign/web-to-figma/commit/eaca85c9b10e7fccdf37f96b90c13c8a8c66eabf) Thanks [@stefanofa](https://github.com/stefanofa)! - Wrap Figma clipboard markers in `data-metadata` and `data-buffer` attributes so Safari/WebKit HTML clipboard sanitization preserves the payload.

## 0.0.1

### Patch Changes

- [#8](https://github.com/figitdesign/web-to-figma/pull/8) [`880001a`](https://github.com/figitdesign/web-to-figma/commit/880001a850b88a2b6b0372640bad733d1f2ff1b5) Thanks [@stefanofa](https://github.com/stefanofa)! - Initial release. Low-level encoder for Figma's Kiwi binary format and HTML clipboard envelope, extracted from `@figit/dom-to-figma`. Exposes `encodeFigmaData`, `composeClipboardHtml`, `toClipboardItem`, `KiwiWriter`, and the bundled Figma Kiwi schema. Ships with a `pnpm extract-schema` CLI that regenerates the schema from a fresh Figma clipboard copy.
