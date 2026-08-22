# @figit/dom-to-figma

## 0.2.3

### Patch Changes

- [#41](https://github.com/figitdesign/web-to-figma/pull/41) [`0d3c9ea`](https://github.com/figitdesign/web-to-figma/commit/0d3c9eac37e274f08a5005868a60f5604d2d8eb5) Thanks [@niko047](https://github.com/niko047)! - Render the CSS 3D border styles (`groove`, `ridge`, `inset`, `outset`) with
  Chrome's bevel shading instead of a flat stroke in the declared color. Each side
  is painted as a filled trapezoid — reusing the per-side-color decomposition, so
  the 45° miters still match CSS — shaded by Blink's own rules: sides facing away
  from the top-left light source are darkened, and `groove`/`ridge` split every
  side in half and shade the halves in opposite directions. When darkening a color
  would leave too little contrast to read as a bevel (dark navy, black), the lit
  sides are lightened instead, as Chrome does.

- [#46](https://github.com/figitdesign/web-to-figma/pull/46) [`ec38305`](https://github.com/figitdesign/web-to-figma/commit/ec38305e32fab580a7e04ebd11e6e66630d847e7) Thanks [@niko047](https://github.com/niko047)! - Draw CSS `outline` and paint dashed/dotted borders as fitted geometry.

  An `outline` was dropped entirely: a Figma node's single stroke already belongs
  to the border and hugs the box, so it cannot stand off by `outline-offset`. The
  ring now becomes its own oversized child frame whose INSIDE stroke lands exactly
  where CSS paints it, following the border radius as CSS does.

  Dashed and dotted borders were drawn solid, or with one dash pattern phased
  continuously around the whole box, because Figma carries a single pattern per
  node. Chrome instead fits the dashes to each side, landing one in every corner,
  so the two drifted out of step. Each side's dashes are now painted as their own
  geometry using Chrome's fit — the dash fixed at twice the border width, the
  count chosen so the resulting gap comes closest to its nominal width — which
  also lets a border mix `solid`, `dashed`, `dotted` and `double` sides. A rounded
  box is fitted as one loop instead, its dashes cut into bands across the straight
  runs and arc sectors around the corners.

- [#48](https://github.com/figitdesign/web-to-figma/pull/48) [`922e12e`](https://github.com/figitdesign/web-to-figma/commit/922e12e9b2bc245edae38c36478f91818ac08ddf) Thanks [@niko047](https://github.com/niko047)! - Convert `conic-gradient` and the repeating gradient functions instead of
  dropping them, and keep hard colour stops hard.

  `conic-gradient` produced no paint at all, so an element carrying one rendered
  empty; it now maps to Figma's angular paint, with gradient space rotated a
  quarter turn because Figma's sweep starts at three o'clock where CSS starts at
  twelve. `repeating-linear-gradient` and `repeating-radial-gradient` were matched
  by the plain `linear-gradient`/`radial-gradient` parsers and painted as a single
  pass; Figma has no repeating gradient, so the repeat is now baked into the stop
  list by tiling one period across the gradient line.

  That tiling needed two supporting fixes. Stop offsets written in `px` were
  discarded and replaced with an even split, so they now resolve against the real
  gradient line — `|w·sin| + |h·cos|` for a linear ramp, the horizontal radius for
  a radial one. And CSS writes a hard stop as two stops at the same offset, which
  Figma reorders, turning flat bands back into ramps; coincident stops are now
  separated by a sub-pixel epsilon so their source order survives the round trip.

- [#33](https://github.com/figitdesign/web-to-figma/pull/33) [`83202a3`](https://github.com/figitdesign/web-to-figma/commit/83202a39356affe1d8eba0baf9807584adb46e7b) Thanks [@niko047](https://github.com/niko047)! - Render a uniform CSS `dotted` border as a Figma dashed stroke instead of a solid
  line. Dots take the border width with an equal gap, matching Chrome's raster.
  `dashed` stays solid on purpose: Figma runs one dash pattern around the whole
  path while Chrome fits dashes to each side, so a dashed pattern drifts out of
  phase and measures worse than a solid line.

- [#47](https://github.com/figitdesign/web-to-figma/pull/47) [`7dd5da2`](https://github.com/figitdesign/web-to-figma/commit/7dd5da2bc77e722064730ee95768f43bf8f91f70) Thanks [@niko047](https://github.com/niko047)! - Ship the browser's measured box for text nodes and content-sized elements
  instead of an inflated one. Text sizes were padded twice — `ceil(width) + 1`
  when measuring, then a further weight-keyed width buffer when building the node
  — and element frames were rounded up with `Math.ceil`, so every text run was up
  to 4px wider than the DOM laid it out and every content-sized box up to 1px
  wider. On a bordered inline element the padding pushed the text past the
  parent's content box and displaced the right border edge.

  The slack that absorbs Figma remeasuring a run wider than the browser did is
  still applied, but only where it does any work: the line-breaking container
  width. The node's own size, which is transparent and no longer drives wrapping,
  now carries the measured geometry. Block boxes are unaffected — CSS already
  gives them integer widths, so the rounding only ever bit the text-driven
  fractional case.

## 0.2.2

### Patch Changes

- [#31](https://github.com/figitdesign/web-to-figma/pull/31) [`810c2aa`](https://github.com/figitdesign/web-to-figma/commit/810c2aaf947fc6ef7fcb9de6bd95fae38b1469f7) Thanks [@niko047](https://github.com/niko047)! - Bake CSS color-matrix filters (`grayscale`/`brightness`/`contrast`/`invert`/`sepia`/`saturate`) into the Figma fill color. Figma has no color-filter effect, so these were dropped and solid elements rendered in their original, unfiltered color. They are now pre-computed into the fill when the element's whole appearance is that one solid fill — a leaf with no children, text, background-image, or border — the case that is exactly representable. Containers, images, gradients, and text with color filters stay unfiltered (they'd need the filter applied across the subtree, which Figma can't express); `hue-rotate`/`opacity` are not baked. `blur`/`drop-shadow` filters are unaffected — they remain Figma effects.

- [#32](https://github.com/figitdesign/web-to-figma/pull/32) [`cc8d486`](https://github.com/figitdesign/web-to-figma/commit/cc8d4864e6be53d0d5047fbf97283b112b3117f4) Thanks [@niko047](https://github.com/niko047)! - Render CSS radial gradients, angled linear gradients, and `object-fit` faithfully.

  - `radial-gradient(…)` produced no paint at all, leaving the element blank. It now
    converts to a Figma radial paint.
  - Angled linear gradients were mirrored: the transform's horizontal term carried
    the wrong sign, which cancelled out at 0deg/180deg and so went unnoticed. The
    gradient line is now also scaled to the element's box, so the end stops land on
    the same corners the browser uses.
  - `object-fit` was ignored and every image was pasted with Figma's `FILL` (cover).
    `fill`, `cover`, and `contain` now map to `STRETCH`, `FILL`, and `FIT`.

## 0.2.1

### Patch Changes

- [#26](https://github.com/figitdesign/web-to-figma/pull/26) [`0208934`](https://github.com/figitdesign/web-to-figma/commit/0208934deb0b540967ea34dc7360967199341156) Thanks [@niko047](https://github.com/niko047)! - Render CSS `double` borders as two concentric lines instead of one solid stroke. Figma has no native double-border style, so a uniform `border-style: double` now maps the frame's own stroke to the outer line and emits an inset stroked child frame for the inner line, letting the element background show through the gap between them (matching Chrome's 1/3–1/3–1/3 split). Solid and other border styles are unchanged.

- [#30](https://github.com/figitdesign/web-to-figma/pull/30) [`51b5821`](https://github.com/figitdesign/web-to-figma/commit/51b582107bf12cd01fd9a1bae309eb14a4f95edb) Thanks [@niko047](https://github.com/niko047)! - Render CSS `filter: drop-shadow()` as a Figma drop shadow. Previously only `filter: blur()` was handled, so `drop-shadow()` was dropped and the element rendered flat. Each `drop-shadow()` in the filter now maps to a `DROP_SHADOW` effect — parsed paren-aware so nested `rgba()`/`hsl()` colors survive — sharing the `text-shadow` parser since both are offset+blur+color shadows with no `inset` or spread. `blur()` handling is unchanged; color-matrix filters (`grayscale`/`brightness`/`contrast`) remain unsupported (no Figma equivalent).

- [#24](https://github.com/figitdesign/web-to-figma/pull/24) [`87db0f2`](https://github.com/figitdesign/web-to-figma/commit/87db0f2a05865c6067b4a703efa8ccac02eeb004) Thanks [@niko047](https://github.com/niko047)! - Render per-side border colors instead of collapsing them to one. A Figma frame
  carries a single stroke color, so a box with four different solid border colors
  (`border-top-color` … `border-left-color`) previously painted the whole border
  with the top color. When the visible sides are all `solid` but disagree on
  color, the border is now decomposed into one filled VECTOR trapezoid per side —
  reproducing CSS's 45° mitered corners exactly — and the frame's own stroke is
  dropped. Uniform borders (and per-side widths with a shared color) keep the
  single-stroke fast path, and dashed/dotted/double sides are left untouched.

- [#25](https://github.com/figitdesign/web-to-figma/pull/25) [`ac830db`](https://github.com/figitdesign/web-to-figma/commit/ac830db5b89d2e8e7eede86f9419303988ae1938) Thanks [@niko047](https://github.com/niko047)! - Render pure-ring box-shadows (`0 0 0 <spread>`) as an OUTSIDE stroke. Figma does
  not draw a zero-offset, zero-blur, positive-spread `DROP_SHADOW`, so a CSS ring
  was disappearing. Such shadows now become an OUTSIDE frame stroke whose weight is
  the spread and whose paint is the shadow color, so the ring follows the corner
  radius and no longer changes the node size. Shadows with any blur or offset stay
  `DROP_SHADOW`, and elements with a real CSS border keep their border stroke (the
  ring falls back to the drop-shadow effect there).

- [#23](https://github.com/figitdesign/web-to-figma/pull/23) [`051ba3b`](https://github.com/figitdesign/web-to-figma/commit/051ba3b9e73d4b0c8001c7f80953265ea683ca75) Thanks [@niko047](https://github.com/niko047)! - Fix the horizontal position of non-centered text. The width buffer that absorbs
  browser/OpenType.js measurement differences was split evenly around the text box
  (`x - widthBuffer / 2`), which assumed centered text and shifted every
  left-aligned run half a buffer to the left of the browser position (and
  right-aligned runs half a buffer right). The buffer now goes on the edge the
  text grows away from — trailing for left, split for center, leading for right —
  so the glyph origin lands where the browser put it. The box keeps its buffered
  width (load-bearing: it stops Figma re-wrapping the fixed-width box). Confirmed
  against Figma, which previously normalized our shifted boxes back on paste (a
  tier-1 round-trip mismatch) and now round-trips them losslessly; on the local
  corpus this clears every `geometry.x` text finding (e.g. `text-in-box` 28 → 14).

- [#29](https://github.com/figitdesign/web-to-figma/pull/29) [`774a670`](https://github.com/figitdesign/web-to-figma/commit/774a670a99950fe7927e971816adaee6d792dd85) Thanks [@niko047](https://github.com/niko047)! - Render CSS `text-shadow` as a Figma text drop shadow. Text nodes previously dropped `text-shadow` entirely, so shadowed headings and labels rendered flat. Each comma-separated shadow now maps to a `DROP_SHADOW` effect on the TEXT node — reusing the box-shadow parser, since `text-shadow` shares its grammar but has no `inset` keyword or spread radius — matching how CSS paints the shadow behind the glyphs. Text without a shadow is unchanged.

## 0.2.0

### Minor Changes

- [#21](https://github.com/figitdesign/web-to-figma/pull/21) [`31c4809`](https://github.com/figitdesign/web-to-figma/commit/31c4809d156b57b79b4e33d2d62e80861d9b3e16) Thanks [@niko047](https://github.com/niko047)! - Add opt-in `trace` mode. `createFigmaConverter({ trace: true })` returns a `ConvertTrace` on the result, mapping every emitted Figma node GUID back to its source DOM element (`domPath`, `rect`, `kind`, `tag`, `text`). It is off by default, adds no cost when disabled, and does not change the payload bytes.

### Patch Changes

- [#21](https://github.com/figitdesign/web-to-figma/pull/21) [`31c4809`](https://github.com/figitdesign/web-to-figma/commit/31c4809d156b57b79b4e33d2d62e80861d9b3e16) Thanks [@niko047](https://github.com/niko047)! - Preserve CSS `transform` (rotate/skew/scale) on leaf frame elements. Previously
  these were flattened to their axis-aligned bounding box; now the node keeps its
  untransformed size and carries a Figma matrix derived from the computed
  transform (assuming the default `transform-origin: center`). Transformed
  elements with children keep the flattened-bbox behavior for now: in Figma the
  matrix would apply to the whole subtree while descendants are still measured in
  transformed screen space, so a parent matrix would transform them twice.

- [#21](https://github.com/figitdesign/web-to-figma/pull/21) [`31c4809`](https://github.com/figitdesign/web-to-figma/commit/31c4809d156b57b79b4e33d2d62e80861d9b3e16) Thanks [@niko047](https://github.com/niko047)! - Convert raster `<img>` elements in non-secure contexts. Image conversion
  hashed the bytes with `crypto.subtle`, which is only available in secure
  contexts — on a plain `about:blank`/`http:`/`file:` page it is `undefined`, so
  the hash threw and the image node was silently dropped (the browser rendered
  nothing where the image should be). SHA-1 now falls back to a pure-JS digest
  when `crypto.subtle` is absent, so images convert everywhere the converter runs.
- Updated dependencies [[`31c4809`](https://github.com/figitdesign/web-to-figma/commit/31c4809d156b57b79b4e33d2d62e80861d9b3e16)]:
  - @figit/fig-kiwi@0.2.0

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
