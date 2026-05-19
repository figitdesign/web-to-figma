# @figit/fig-kiwi

## 0.0.1

### Patch Changes

- [#8](https://github.com/figitdesign/web-to-figma/pull/8) [`880001a`](https://github.com/figitdesign/web-to-figma/commit/880001a850b88a2b6b0372640bad733d1f2ff1b5) Thanks [@stefanofa](https://github.com/stefanofa)! - Initial release. Low-level encoder for Figma's Kiwi binary format and HTML clipboard envelope, extracted from `@figit/dom-to-figma`. Exposes `encodeFigmaData`, `composeClipboardHtml`, `toClipboardItem`, `KiwiWriter`, and the bundled Figma Kiwi schema. Ships with a `pnpm extract-schema` CLI that regenerates the schema from a fresh Figma clipboard copy.
