---
class: pixel.region
status: open
severity: 17.496296296296293
firstSeenRun: 20260812-111119
lastSeenRun: 20260828-010002
lastAttemptRun: parity
attempts: 1
cooldownUntilRun: null
exemplarScene: fx/fx-06-text-shadow
exemplarFindingId: 52d3a779587a
tier: 2
issue: null
---
## Analysis
_TODO: why this discrepancy happens._

## Attempts
- run parity: Extended the fontsource loader to pick a script subset from the run's own characters, which fixed the Cyrillic and Greek rows of txt/txt-18-unicode; then looked at whether the same scene's emoji row could follow. → Emoji need a colour font (Apple Color Emoji in the ground truth, Noto Color Emoji on fontsource). Both store glyphs as CBDT/sbix bitmaps or COLR/CPAL layers, and the converter's glyph model is one monochrome outline blob per character, so fontkit returns an empty path and Figma paints nothing. Supporting them means a layered or bitmap glyph representation in the payload, not a loader change.

## Verdict
