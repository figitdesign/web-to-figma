# Converter fidelity hypotheses

A living catalog of things the converter should reproduce faithfully. **Each row
is a hypothesis** — "the converter correctly handles X" — and becomes one
**minimal scene** (`packages/dom-to-figma/scripts/oracle-scenes/<domain>/<ID>.html`)
that isolates exactly that feature.

**How they're checked:** every full local run (`pnpm oracle:loop`) pastes each scene into Figma and
pixel-diffs it (Tiers 1–2). A clean scene confirms the hypothesis; a discrepancy
is a real converter bug that gets baselined and becomes a fix-target for the
`/fix-discrepancy` agent. Because each scene isolates one feature, a failure
dominates that small scene's pixels — so even a "minor" feature ranks as a strong
finding and actually gets worked, instead of drowning in a busy scene.

**Lifecycle:** new hypothesis → scene → first run baselines it (often broken, like
the exotic scenes) → agent fixes it → ratchet keeps it fixed forever. Extend this
list freely; IDs are stable so a scene, a finding, and a ledger entry all share one.

Priority: **P0** common/high-impact · **P1** frequent · **P2** edge/rare.
Tier that can catch it: **T0** structural (geometry only, today) · **T2** pixels.

---

## Borders (BORD)
- BORD-01 [P0 T2] solid border, all sides equal
- BORD-02 [P0 T2] per-side different widths
- BORD-03 [P0 T2] per-side different colors
- BORD-04 [P1 T2] per-side different styles (solid top, dashed right, …)
- BORD-05 [P0 T2] dashed border
- BORD-06 [P0 T2] dotted border
- BORD-07 [P1 T2] double border
- BORD-08 [P2 T2] groove / ridge / inset / outset (3D styles)
- BORD-09 [P1 T2] dashed **+ border-radius** (curved dashes — notoriously hard)
- BORD-10 [P1 T2] dotted + border-radius
- BORD-11 [P2 T2] sub-pixel border (0.5px hairline)
- BORD-12 [P1 T2] very thick border (20px+)
- BORD-13 [P1 T2] semi-transparent border (rgba)
- BORD-14 [P2 T2] border on an inline element
- BORD-15 [P2 T2] transparent border reserving space
- BORD-16 [P2 T2] outline (vs border) + outline-offset

## Border radius & shape (RAD)
- RAD-01 [P0 T2] uniform radius
- RAD-02 [P0 T2] four different per-corner radii · scene: `rad/rad-02-per-corner`
- RAD-03 [P1 T2] elliptical radius (`20px / 40px`)
- RAD-04 [P0 T2] percentage radius 50% → circle
- RAD-05 [P1 T2] 50% on a non-square box → ellipse
- RAD-06 [P1 T2] radius larger than half (clamping)
- RAD-07 [P1 T2] pill shape (radius = height/2)
- RAD-08 [P1 T2] radius + overflow:hidden clipping a child

## Backgrounds & gradients (BG)
- BG-01 [P0 T2] solid background color
- BG-02 [P0 T2] linear-gradient, 2 stops
- BG-03 [P0 T2] linear-gradient with angle
- BG-04 [P1 T2] linear-gradient, many stops
- BG-05 [P1 T2] gradient with hard color stops (stripes)
- BG-06 [P0 T2] radial-gradient
- BG-07 [P1 T2] radial-gradient positioned + sized
- BG-08 [P2 T2] conic-gradient
- BG-09 [P2 T2] repeating-linear / repeating-radial
- BG-10 [P1 T2] gradient with alpha/transparent stops
- BG-11 [P1 T2] multiple background layers
- BG-12 [P1 T2] background raster image
- BG-13 [P1 T2] background-size cover / contain
- BG-14 [P1 T2] background-position / repeat
- BG-15 [P2 T2] background-clip: text
- BG-16 [P1 T2] gradient + border-radius together

## Shadows & effects (FX)
- FX-01 [P0 T2] box-shadow, single
- FX-02 [P1 T2] box-shadow inset
- FX-03 [P1 T2] multiple box-shadows
- FX-04 [P1 T2] box-shadow with spread
- FX-05 [P1 T2] colored / rgba shadow
- FX-06 [P1 T2] text-shadow
- FX-07 [P2 T2] filter: blur
- FX-08 [P2 T2] filter: drop-shadow
- FX-09 [P2 T2] filter: brightness / contrast / grayscale
- FX-10 [P2 T2] backdrop-filter
- FX-11 [P2 T2] mix-blend-mode
- FX-12 [P0 T2] element opacity vs rgba color · scene: `fx/fx-12-opacity-vs-rgba`
- FX-13 [P1 T2] nested opacity stacking (parent .5 × child .5)

## SVG (SVG)
- SVG-01 [P0 T2] inline SVG rect / circle · scene: `svg/svg-01-shapes`
- SVG-02 [P0 T2] SVG path fill
- SVG-03 [P1 T2] SVG stroke (width, color)
- SVG-04 [P1 T2] SVG stroke-dasharray (dashed vector)
- SVG-05 [P1 T2] stroke-linecap / linejoin
- SVG-06 [P1 T2] SVG linearGradient / radialGradient defs
- SVG-07 [P1 T2] viewBox scaling / preserveAspectRatio
- SVG-08 [P2 T2] SVG <text>
- SVG-09 [P2 T2] SVG transform on a group
- SVG-10 [P2 T2] clipPath / mask
- SVG-11 [P1 T2] currentColor inheritance
- SVG-12 [P1 T2] multiple paths / groups
- SVG-13 [P1 T2] SVG referenced via `<img src=.svg>`
- SVG-14 [P2 T2] SVG with fill-rule evenodd

## Typography (TXT)
- TXT-01 [P0 T2] font-weight scale (300/400/700/900)
- TXT-02 [P0 T2] italic
- TXT-03 [P0 T2] line-height variations
- TXT-04 [P1 T2] letter-spacing
- TXT-05 [P2 T2] word-spacing
- TXT-06 [P0 T2] text-align left/center/right/justify
- TXT-07 [P1 T2] underline / line-through / overline
- TXT-08 [P2 T2] text-decoration style/color/thickness
- TXT-09 [P1 T2] text-transform uppercase/capitalize
- TXT-10 [P1 T2] text-overflow: ellipsis (single line)
- TXT-11 [P1 T2] white-space nowrap / pre / pre-wrap
- TXT-12 [P0 T2] multi-line wrapping in a fixed-width box
- TXT-13 [P1 T2] mixed inline styles (bold/colored span inside text)
- TXT-14 [P2 T2] vertical-align in inline flow
- TXT-15 [P2 T2] super/subscript
- TXT-16 [P1 T2] font-size units (em / rem / %)
- TXT-17 [P2 T2] direction: rtl / writing-mode
- TXT-18 [P2 T2] emoji / non-latin unicode
- TXT-19 [P2 T2] font-feature-settings / tabular-nums
- TXT-20 [P1 T2] font-family fallback chain

## Images (IMG)
- IMG-01 [P0 T2] raster `<img>` · scene: `img/img-01-raster`
- IMG-02 [P0 T2] object-fit cover / contain / fill
- IMG-03 [P1 T2] object-position
- IMG-04 [P1 T2] img + border-radius
- IMG-05 [P2 T2] aspect-ratio box
- IMG-06 [P2 T2] data-URI image
- IMG-07 [P2 T2] broken image (alt/placeholder)

## Transforms (XFRM)  *(rotate already fixed)*
- XFRM-01 [P0 T0] rotate
- XFRM-02 [P0 T0] scale
- XFRM-03 [P1 T0] skew
- XFRM-04 [P0 T0] translate
- XFRM-05 [P1 T0] combined translate+rotate+scale
- XFRM-06 [P1 T0] transform-origin variations
- XFRM-07 [P2 T2] 3D transform (rotateX/Y, perspective)
- XFRM-08 [P1 T0] nested transforms (child of a rotated parent)

## Flex layout (FLEX)
- FLEX-01 [P0 T0] justify-content variants
- FLEX-02 [P0 T0] align-items variants
- FLEX-03 [P1 T0] flex-wrap
- FLEX-04 [P0 T0] gap
- FLEX-05 [P1 T0] flex-grow / shrink / basis
- FLEX-06 [P2 T0] order
- FLEX-07 [P1 T0] nested flex
- FLEX-08 [P1 T0] align-self
- FLEX-09 [P1 T0] min/max width interaction

## Grid layout (GRID)
- GRID-01 [P0 T0] template columns / rows
- GRID-02 [P0 T0] gap
- GRID-03 [P1 T0] column/row span
- GRID-04 [P1 T0] auto-fit / auto-fill minmax
- GRID-05 [P2 T0] named areas
- GRID-06 [P1 T0] justify/align items & content
- GRID-07 [P2 T0] implicit tracks

## Positioning & stacking (POS)
- POS-01 [P0 T0] absolute positioning
- POS-02 [P1 T0] relative offset
- POS-03 [P0 T2] z-index ordering · scene: `pos/pos-03-z-index`
- POS-04 [P1 T2] negative z-index
- POS-05 [P1 T2] overlapping siblings
- POS-06 [P2 T0] sticky (within a scroll container)

## Overflow & clipping (CLIP)
- CLIP-01 [P0 T2] overflow: hidden clips a child · scene: `clip/clip-01-overflow-hidden`
- CLIP-02 [P1 T2] overflow content visible (spills out)
- CLIP-03 [P2 T2] clip-path inset / circle / polygon
- CLIP-04 [P2 T2] mask-image
- CLIP-05 [P1 T2] rounded clip (radius + overflow hidden)

## Box model & sizing (BOX)
- BOX-01 [P0 T0] box-sizing border-box vs content-box
- BOX-02 [P0 T0] padding
- BOX-03 [P1 T0] margin collapse
- BOX-04 [P1 T0] min/max width & height
- BOX-05 [P1 T0] aspect-ratio property
- BOX-06 [P1 T0] percentage width/height
- BOX-07 [P2 T0] calc() sizes
- BOX-08 [P2 T0] fit-content / min-content / max-content

## Color & opacity (COL)
- COL-01 [P0 T2] rgba
- COL-02 [P1 T2] hsl / hsla
- COL-03 [P1 T2] hex 3 / 6 / 8 digit
- COL-04 [P1 T2] currentColor
- COL-05 [P2 T2] color-mix / relative color
- COL-06 [P2 T2] named colors

## Pseudo-elements & generated content (GEN)
- GEN-01 [P1 T2] ::before / ::after content
- GEN-02 [P2 T2] ::first-line / ::first-letter
- GEN-03 [P1 T2] list markers (ul / ol, list-style-type)
- GEN-04 [P2 T2] CSS counters
- GEN-05 [P2 T2] quotes / content strings

## Tables (TBL)
- TBL-01 [P1 T2] basic table grid
- TBL-02 [P1 T2] border-collapse
- TBL-03 [P2 T2] colspan / rowspan
- TBL-04 [P2 T2] caption / thead styling

## Form controls (FORM)  *(native widgets render idiosyncratically)*
- FORM-01 [P2 T2] text input / textarea
- FORM-02 [P2 T2] button
- FORM-03 [P2 T2] checkbox / radio
- FORM-04 [P2 T2] select
- FORM-05 [P2 T2] placeholder text

## Hard / cross-cutting (EDGE)
- EDGE-01 [P1 T0] CSS custom properties (var())
- EDGE-02 [P1 T0] 1px hairline rendering
- EDGE-03 [P1 T0] fractional-pixel positions
- EDGE-04 [P2 T0] zero-size elements
- EDGE-05 [P2 T0] very deep nesting
- EDGE-06 [P2 T0] many siblings (perf/limits)
- EDGE-07 [P1 T0] visibility:hidden / display:none (should be excluded)
- EDGE-08 [P2 T2] scrollbars in an overflow:scroll box

---

_Extend by appending rows with the next ID in a domain. Turning a batch of these
into scenes is the WS-4.1 generator task; until that lands they can be authored
by hand, highest-priority first._
