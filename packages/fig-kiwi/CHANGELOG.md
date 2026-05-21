# @figit/fig-kiwi

## 0.0.2

### Patch Changes

- [#17](https://github.com/figitdesign/web-to-figma/pull/17) [`eaca85c`](https://github.com/figitdesign/web-to-figma/commit/eaca85c9b10e7fccdf37f96b90c13c8a8c66eabf) Thanks [@stefanofa](https://github.com/stefanofa)! - Wrap Figma clipboard markers in `data-metadata` and `data-buffer` attributes so Safari/WebKit HTML clipboard sanitization preserves the payload.

## 0.0.1

### Patch Changes

- [#8](https://github.com/figitdesign/web-to-figma/pull/8) [`880001a`](https://github.com/figitdesign/web-to-figma/commit/880001a850b88a2b6b0372640bad733d1f2ff1b5) Thanks [@stefanofa](https://github.com/stefanofa)! - Initial release. Low-level encoder for Figma's Kiwi binary format and HTML clipboard envelope, extracted from `@figit/dom-to-figma`. Exposes `encodeFigmaData`, `composeClipboardHtml`, `toClipboardItem`, `KiwiWriter`, and the bundled Figma Kiwi schema. Ships with a `pnpm extract-schema` CLI that regenerates the schema from a fresh Figma clipboard copy.
