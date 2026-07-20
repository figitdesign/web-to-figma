---
"@figit/dom-to-figma": patch
---

Convert raster `<img>` elements in non-secure contexts. Image conversion
hashed the bytes with `crypto.subtle`, which is only available in secure
contexts — on a plain `about:blank`/`http:`/`file:` page it is `undefined`, so
the hash threw and the image node was silently dropped (the browser rendered
nothing where the image should be). SHA-1 now falls back to a pure-JS digest
when `crypto.subtle` is absent, so images convert everywhere the converter runs.
