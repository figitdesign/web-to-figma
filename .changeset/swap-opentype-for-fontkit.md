---
"@sleekdesign/dom-to-figma": patch
---

Swap `opentype.js` for `fontkit` in the text pipeline. The default fontsource loader now downloads `.woff2` instead of `.ttf` (~65% smaller per font; fontkit decompresses transparently). Public API and behavior are unchanged: per-character glyph mapping is preserved, the SHA-1 `fontDigest` over file bytes is unchanged in shape, and the manual GPOS pair-adjustment walker is replaced by a fontkit `layout()` call that picks up both legacy `kern` and modern GPOS automatically.
