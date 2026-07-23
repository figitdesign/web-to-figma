---
"@figit/dom-to-figma": patch
---

Render CSS `text-shadow` as a Figma text drop shadow. Text nodes previously dropped `text-shadow` entirely, so shadowed headings and labels rendered flat. Each comma-separated shadow now maps to a `DROP_SHADOW` effect on the TEXT node — reusing the box-shadow parser, since `text-shadow` shares its grammar but has no `inset` keyword or spread radius — matching how CSS paints the shadow behind the glyphs. Text without a shadow is unchanged.
