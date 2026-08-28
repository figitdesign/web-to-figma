---
"@figit/dom-to-figma": patch
---

Fix three typography gaps found by the visual-parity oracle:

- `text-decoration: line-through` and `overline` are now drawn. Only underline
  was emitted before, so struck-through and overlined text pasted into Figma
  with no rule at all. Rules also use the font's own `post` thickness instead
  of a flat ratio of the font size, which was drawing them about a quarter as
  thick as the browser.
- Non-latin text now loads the matching Google Fonts subset. The loader always
  fetched `latin`, so Cyrillic and Greek runs were laid out against `.notdef`
  and painted blank.
- `font-variant-numeric` and `font-feature-settings` are now applied when
  resolving glyphs, so `tabular-nums` picks the tabular figures the browser
  uses rather than the font's proportional defaults.
