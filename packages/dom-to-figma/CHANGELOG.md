# @figit/dom-to-figma

## 0.1.0

### Minor Changes

- [#19](https://github.com/figitdesign/web-to-figma/pull/19) [`4c0c004`](https://github.com/figitdesign/web-to-figma/commit/4c0c00487b610fdfc0935f3efb5679ba60155a6c) Thanks [@niko047](https://github.com/niko047)! - Infer native Figma auto-layout from the DOM.

  `@figit/dom-to-figma` now converts flex, block flow, wrapping rows, and grids into real Figma auto-layout frames (`stackMode`, spacing, padding, hug/fill/stretch sizing), with absolutely positioned children carried over as absolute-positioned layers. Inference is per-container and verified against the browser's measured geometry — any container it can't reproduce exactly falls back to absolute positioning, so the result is never worse than a fixed-position paste.

  **Behavior change:** auto-layout is now the default. `createFigmaConverter()` infers auto-layout out of the box; pass `layout: "absolute"` to keep the previous fixed-position behavior. This is geometrically backward-compatible (positions and sizes are preserved), but pasted frames now arrive as editable stacks instead of absolutely-positioned frames.

  `@figit/fig-kiwi` gains a clipboard decoder (`decodeFigmaData`, `parseClipboardHtml`) that reads Figma's copy payloads — schema-driven via the payload's own embedded schema and handling zstd-compressed data chunks — plus shared auto-layout field metadata (`STACK_FIELD_DEFAULTS`, `TRACKED_STACK_FIELDS`).

### Patch Changes

- Updated dependencies [[`4c0c004`](https://github.com/figitdesign/web-to-figma/commit/4c0c00487b610fdfc0935f3efb5679ba60155a6c)]:
  - @figit/fig-kiwi@0.1.0

## 0.0.2

### Patch Changes

- [#16](https://github.com/figitdesign/web-to-figma/pull/16) [`63bbf23`](https://github.com/figitdesign/web-to-figma/commit/63bbf23140a4f9e927064be60ee28ace4af5c0aa) Thanks [@stefanofa](https://github.com/stefanofa)! - Internal cleanup surfaced by Knip: drop unused exports and dead type aliases, remove the no-longer-needed `@vitest/browser` devDependency (Vitest 4 only needs the provider package). No runtime or behavior changes. The published `.d.ts` no longer exposes a handful of internal-only types (e.g. `FigmaShadowEffect`, `FigmaBlendMode`, `DecorationRect`) that were exported but never consumed from outside the package.

- [#17](https://github.com/figitdesign/web-to-figma/pull/17) [`eaca85c`](https://github.com/figitdesign/web-to-figma/commit/eaca85c9b10e7fccdf37f96b90c13c8a8c66eabf) Thanks [@stefanofa](https://github.com/stefanofa)! - Wrap Figma clipboard markers in `data-metadata` and `data-buffer` attributes so Safari/WebKit HTML clipboard sanitization preserves the payload.

- Updated dependencies [[`eaca85c`](https://github.com/figitdesign/web-to-figma/commit/eaca85c9b10e7fccdf37f96b90c13c8a8c66eabf)]:
  - @figit/fig-kiwi@0.0.2

## 0.0.1

### Patch Changes

- [#8](https://github.com/figitdesign/web-to-figma/pull/8) [`880001a`](https://github.com/figitdesign/web-to-figma/commit/880001a850b88a2b6b0372640bad733d1f2ff1b5) Thanks [@stefanofa](https://github.com/stefanofa)! - Move the encoder, Figma Kiwi schema, and HTML clipboard envelope into a new `@figit/fig-kiwi` package, now consumed as a runtime dependency. Public API and behavior are unchanged. The direct `pako` dependency is dropped; `fflate` is used (via fig-kiwi) for the deflate path — smaller and faster.

- [#2](https://github.com/figitdesign/web-to-figma/pull/2) [`4d0ba6f`](https://github.com/figitdesign/web-to-figma/commit/4d0ba6f11a230c501f4d275450ca70e34f64c197) Thanks [@mattiapomelli](https://github.com/mattiapomelli)! - Read CSS `opacity` from each element's computed style instead of hardcoding `1`, so elements with opacity below 1 render correctly in Figma.

- [#1](https://github.com/figitdesign/web-to-figma/pull/1) [`aaaaea5`](https://github.com/figitdesign/web-to-figma/commit/aaaaea5a264d4367fca8f2745a01f8c259759719) Thanks [@mattiapomelli](https://github.com/mattiapomelli)! - Preserve cutouts in SVG compound paths when converting to Figma. Subpaths inside a single `<path>` element are now merged into one Figma vector region with multiple loops, and the encoder's winding-rule bit was flipped to match Figma's actual format. Outline icons (e.g. Phosphor speech bubbles, circle-plus icons with `fill-rule="evenodd"`) now render with their inner holes instead of as solid silhouettes.

- [#9](https://github.com/figitdesign/web-to-figma/pull/9) [`c2d7483`](https://github.com/figitdesign/web-to-figma/commit/c2d748351496e7530703abd492dcbaf95bb7dc5b) Thanks [@stefanofa](https://github.com/stefanofa)! - Swap `opentype.js` for `fontkit` in the text pipeline. The default fontsource loader now downloads `.woff2` instead of `.ttf` (~65% smaller per font; fontkit decompresses transparently). Public API and behavior are unchanged: per-character glyph mapping is preserved, the SHA-1 `fontDigest` over file bytes is unchanged in shape, and the manual GPOS pair-adjustment walker is replaced by a fontkit `layout()` call that picks up both legacy `kern` and modern GPOS automatically.

- [#11](https://github.com/figitdesign/web-to-figma/pull/11) [`2495f4c`](https://github.com/figitdesign/web-to-figma/commit/2495f4cba1bde3280a77937d70d8f1f5837e3eb6) Thanks [@stefanofa](https://github.com/stefanofa)! - Several text correctness fixes that align our output with what Figma writes itself when copying a TEXT node:

  - `fontMetaData[*].fontLineHeight` is now the font's intrinsic line-height ratio `(asc - desc + gap) / unitsPerEm` (≈ 1.2 for most fonts) rather than the user's CSS line-height in pixels. The user's chosen line-height already lives on `nc.lineHeight`.
  - `fontMetaData[*].fontDigest` removed. Figma stores its own font copies and computes its own digest; ours hashed fontsource bytes that don't match anyway, and the field lives in `derivedTextData` (the layout cache) which Figma rebuilds on import.
  - `fontMetaData[*].key.postscript` is now `""` to match Figma's wire format. The PostScript name still rides on the top-level `fontName.postscript`.
  - `derivedTextData.baselines[*].endCharacter` is now exclusive (`firstCharacter + length`) — Figma uses `[start, end)` half-open intervals.
  - `fontVariantDiscretionaryLigatures` defaults to `false`. CSS `font-variant-ligatures: normal` does not enable discretionary ligatures.
  - Emit `textBidiVersion: 1` and `textExplicitLayoutVersion: 1` to match what Figma's own clipboard output writes.

- Updated dependencies [[`880001a`](https://github.com/figitdesign/web-to-figma/commit/880001a850b88a2b6b0372640bad733d1f2ff1b5)]:
  - @figit/fig-kiwi@0.0.1
