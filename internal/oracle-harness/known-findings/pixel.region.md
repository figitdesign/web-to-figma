---
class: pixel.region
status: open
severity: 17.496296296296293
firstSeenRun: 20260812-111119
lastSeenRun: 20260827-010001
lastAttemptRun: parity
attempts: 1
cooldownUntilRun: null
exemplarScene: fx/fx-06-text-shadow
exemplarFindingId: 52d3a779587a
tier: 2
issue: null
---
## Analysis
Every text-bearing scene in the corpus carries a floor of roughly 0.4–4%
regardless of what the scene is actually testing, and measuring the glyph ink
box on `fx/fx-06-text-shadow` (Arial Bold 44px, "Shadow") shows why:

| | x span | y span |
|---|---|---|
| ground truth | 26–192 | 32–63 |
| Figma | 26–196 | 33.5–66 |

The typeface matches — this is not a font substitution. What differs is that
Figma's glyphs sit ~1.5px lower and run ~2% wide. The vertical component is the
larger contributor and it is the same on every text node, which is why a scene
like `txt/txt-15-super-subscript` can render its feature perfectly (the raised
and lowered runs land exactly where the browser puts them) and still measure
~1%: the whole block is shifted.

The offset is Figma-side. Figma re-derives text layout on paste rather than
consuming the `derivedTextData.baselines` we ship — see the attempt below,
where moving our computed baseline *up* moved the render *down*. That leaves
the emitted `lineHeight`/`fontSize`/`size` triple as the only lever, and none of
them is currently wrong in a way that explains 1.5px.

Practical consequence for scene authors: a text scene's tier-2 floor is ~1% and
a finding is only attributable to the feature under test once it clears that.

## Attempts
- run parity: Resolved CSS line-height:normal from the font's own ascent+descent+lineGap (metrics.lineHeightRatio) instead of the fontSize*1.2 stand-in, so the half-leading that positions the baseline matches what the browser used. → Made it worse. Figma re-derives text layout on paste and ignores the baselines we ship, and its own vertical placement moves the opposite way to ours: shrinking Arial 44px line-height from 52.8 to 50.6 pushed the rendered glyphs 1px further DOWN, away from ground truth. fx/fx-06-text-shadow regressed 2.80% -> 3.94% and 05-exotic/text-in-box 3.77% -> 3.86%. The residual ~1.5px downward offset on every text node is Figma-side re-derivation, not a value we control through lineHeight; compensating by inflating lineHeight would break multi-line pitch.

## Verdict
