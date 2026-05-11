---
"@sleekdesign/dom-to-figma": patch
---

Several text correctness fixes that align our output with what Figma writes itself when copying a TEXT node:

- `fontMetaData[*].fontLineHeight` is now the font's intrinsic line-height ratio `(asc - desc + gap) / unitsPerEm` (≈ 1.2 for most fonts) rather than the user's CSS line-height in pixels. The user's chosen line-height already lives on `nc.lineHeight`.
- `fontMetaData[*].fontDigest` removed. Figma stores its own font copies and computes its own digest; ours hashed fontsource bytes that don't match anyway, and the field lives in `derivedTextData` (the layout cache) which Figma rebuilds on import.
- `fontMetaData[*].key.postscript` is now `""` to match Figma's wire format. The PostScript name still rides on the top-level `fontName.postscript`.
- `derivedTextData.baselines[*].endCharacter` is now exclusive (`firstCharacter + length`) — Figma uses `[start, end)` half-open intervals.
- `fontVariantDiscretionaryLigatures` defaults to `false`. CSS `font-variant-ligatures: normal` does not enable discretionary ligatures.
- Emit `textBidiVersion: 1` and `textExplicitLayoutVersion: 1` to match what Figma's own clipboard output writes.
