---
"@figit/dom-to-figma": patch
---

Carry CSS `mix-blend-mode` onto the Figma node's blend mode. The property was
read by nothing, so every blended element pasted as an opaque `PASS_THROUGH`
node and simply covered whatever it was meant to blend with. On the new
`fx/fx-11-mix-blend-mode` scene an amber box with `mix-blend-mode: multiply`
overlapping a blue one painted flat amber over the overlap, a 6.9% tier-2 pixel
diff that drops to 0. All sixteen CSS blend keywords map to their Figma
equivalent, plus `plus-lighter`/`plus-darker` to linear dodge/burn; `normal` and
anything Figma cannot express leave the node at its `PASS_THROUGH` default.
