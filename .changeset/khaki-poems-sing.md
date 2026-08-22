---
"@figit/dom-to-figma": patch
---

Convert `conic-gradient` and the repeating gradient functions instead of
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
