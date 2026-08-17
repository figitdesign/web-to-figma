import type { Border3dStyle } from "../../styles/border-3d";
import { border3dSideColor, isBorder3dStyle } from "../../styles/border-3d";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import type { FigmaBlob, FigmaGuid, FigmaVectorNodeChange } from "../../types";
import { svgPathToVectorNetworkWithScaling } from "../vector/vector-networks";
import { vectorNetworkToBytes } from "../vector/vector-networks/encoder";
import type { BorderPathPiece } from "./rounded-dash-border";
import { roundedDashedBorderPieces } from "./rounded-dash-border";

/**
 * Per-side border color/style decomposition.
 *
 * A Figma frame carries a single `strokePaints` color and a single dash
 * pattern, so one stroke cannot express four different border colors — nor a
 * border that is `solid` on one side and `dashed` on the next. When the visible
 * sides disagree on either, we drop the frame stroke and paint each side as its
 * own filled VECTOR geometry — matching CSS's 45° mitered corners exactly — so
 * red/green/blue/orange edges survive the round-trip instead of collapsing to
 * the top color. Uniform borders keep the single-stroke fast path.
 *
 * `dashed` and `dotted` sides are cut into their individual dashes, fitted the
 * way Chrome fits them: per side, landing a dash in each corner. That applies
 * to uniform patterned borders too, which Figma would otherwise phase
 * continuously around the box and drift out of step. Rounded boxes have no
 * independent sides and go to `rounded-dash-border.ts` instead.
 *
 * The same trapezoids also carry the 3D styles (`groove`/`ridge`/`inset`/
 * `outset`): those are uniform in the declared color but *painted* with a
 * per-side shade, and `groove`/`ridge` additionally split each side in half.
 * See `styles/border-3d.ts` for the shading; here we only cut the bands.
 */

type SideKey = "top" | "right" | "bottom" | "left";

const SIDE_KEYS: ReadonlyArray<SideKey> = ["top", "right", "bottom", "left"];

type BorderSide = {
  width: number;
  color: string;
  style: string;
};

type BorderSides = Record<SideKey, BorderSide>;

/** A convex polygon (frame-local coordinates) plus the CSS color to fill it. */
type SideQuad = {
  points: ReadonlyArray<readonly [number, number]>;
  color: string;
};

/** A pre-built path (frame-local coordinates) plus the CSS color to fill it. */
type SidePath = BorderPathPiece & { color: string };

/** A round dot (frame-local coordinates) plus the CSS color to fill it. */
type SideDot = {
  cx: number;
  cy: number;
  radius: number;
  color: string;
};

type SidePiece = SideQuad | SideDot | SidePath;

function isDot(piece: SidePiece): piece is SideDot {
  return "radius" in piece;
}

function isPath(piece: SidePiece): piece is SidePath {
  return "path" in piece;
}

/** The styles the per-side painter below can draw. */
const PAINTABLE_STYLES: ReadonlyArray<string> = [
  "solid",
  "dashed",
  "dotted",
  "double",
];

/** Chrome draws a `dashed` dash at twice the border width; a `dotted` dot at one. */
const DASH_LENGTH_RATIO = 2;

/**
 * Every dash becomes its own VECTOR node, so a hairline border on a long edge
 * could emit hundreds. Past this the side falls back to a solid trapezoid,
 * which is what the single-stroke path would have drawn anyway.
 */
const MAX_DASHES_PER_SIDE = 64;

function parseBorderSides(style: CSSStyleDeclaration): BorderSides {
  const fallbackColor = style.borderColor;
  const read = (widthProp: string, colorProp: string, styleProp: string) => ({
    width: Number.parseFloat(style.getPropertyValue(widthProp) || "0"),
    color: style.getPropertyValue(colorProp) || fallbackColor || "",
    style: style.getPropertyValue(styleProp) || "solid",
  });
  return {
    top: read("border-top-width", "border-top-color", "border-top-style"),
    right: read(
      "border-right-width",
      "border-right-color",
      "border-right-style"
    ),
    bottom: read(
      "border-bottom-width",
      "border-bottom-color",
      "border-bottom-style"
    ),
    left: read("border-left-width", "border-left-color", "border-left-style"),
  };
}

/**
 * True when at least two visible sides (width > 0) disagree on color or style —
 * the single frame stroke carries one color and one dash pattern, so either
 * disagreement collapses them onto whichever side happens to win.
 *
 * Uniform borders (and single-visible-side borders) return false and keep the
 * single-stroke fast path, as do borders using a style the per-side painter
 * cannot draw (the 3D styles, which {@link uniformBorder3dStyle} handles, and
 * anything else CSS may add).
 */
function borderSidesRequireDecomposition(sides: BorderSides): boolean {
  const visible = SIDE_KEYS.map((key) => sides[key]).filter((s) => s.width > 0);
  const first = visible[0];
  if (visible.length < 2 || !first) {
    return false;
  }
  if (visible.some((side) => !PAINTABLE_STYLES.includes(side.style))) {
    return false;
  }
  return visible.some(
    (side) => side.color !== first.color || side.style !== first.style
  );
}

/**
 * The single corner radius shared by all four corners, or `undefined` when they
 * disagree (or there is no meaningful radius). Only the uniform case has a
 * rounded-rect path simple enough to walk dashes along.
 */
function uniformCornerRadius(style: CSSStyleDeclaration): number | undefined {
  const radii = [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ].map((prop) => Number.parseFloat(style.getPropertyValue(prop) || "0"));
  const first = radii[0];
  if (!first || first <= 0.5) {
    return;
  }
  return radii.every((radius) => radius === first) ? first : undefined;
}

/**
 * True when every visible side is the same `dashed` style, color and width —
 * the only shape the rounded-path dash walker knows how to paint.
 */
function isUniformDashedBorder(sides: BorderSides): boolean {
  const visible = SIDE_KEYS.map((key) => sides[key]).filter((s) => s.width > 0);
  const first = visible[0];
  if (visible.length < 4 || !first || first.style !== "dashed") {
    return false;
  }
  return visible.every(
    (side) =>
      side.style === first.style &&
      side.color === first.color &&
      side.width === first.width
  );
}

/**
 * The 3D style shared by every visible side, or `undefined` when the border is
 * not a uniform 3D one. Mixed styles and mixed colors keep the existing
 * behavior: shading is only well-defined relative to a single declared color,
 * and a per-side mix of 3D and flat styles is BORD-04's problem, not this one.
 */
function uniformBorder3dStyle(sides: BorderSides): Border3dStyle | undefined {
  const visible = SIDE_KEYS.map((key) => sides[key]).filter((s) => s.width > 0);
  const first = visible[0];
  if (visible.length < 2 || !first || !isBorder3dStyle(first.style)) {
    return;
  }
  const style = first.style;
  if (
    !visible.every((side) => side.style === style && side.color === first.color)
  ) {
    return;
  }
  return style;
}

function hasCornerRadius(style: CSSStyleDeclaration): boolean {
  const radii = [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ];
  return radii.some(
    (prop) => Number.parseFloat(style.getPropertyValue(prop) || "0") > 0.5
  );
}

/**
 * The CSS border trapezoids for a `width`×`height` border-box (INSIDE stroke),
 * for the band between two proportional depths through the border.
 *
 * `from`/`to` are fractions of each side's own width, so `0 → 1` is the whole
 * border (the plain per-side-color case) and `0 → 0.5` / `0.5 → 1` are the
 * outer and inner halves a `groove`/`ridge` bevel needs. Each quad spans its
 * side's slice of the band, and the corner vertices are taken at the band's own
 * depths — which keeps CSS's 45° miters at every depth, including between the
 * two halves. Sides with zero width are omitted.
 */
function bandPoints(params: {
  sides: BorderSides;
  width: number;
  height: number;
  side: SideKey;
  from: number;
  to: number;
}): ReadonlyArray<readonly [number, number]> {
  const { sides, width, height, side, from, to } = params;
  // Corner miters at the band's outer depth (`f`) and inner depth (`n`).
  const tf = sides.top.width * from;
  const rf = sides.right.width * from;
  const bf = sides.bottom.width * from;
  const lf = sides.left.width * from;
  const tn = sides.top.width * to;
  const rn = sides.right.width * to;
  const bn = sides.bottom.width * to;
  const ln = sides.left.width * to;

  switch (side) {
    case "top":
      return [
        [lf, tf],
        [width - rf, tf],
        [width - rn, tn],
        [ln, tn],
      ];
    case "right":
      return [
        [width - rf, tf],
        [width - rf, height - bf],
        [width - rn, height - bn],
        [width - rn, tn],
      ];
    case "bottom":
      return [
        [ln, height - bn],
        [width - rn, height - bn],
        [width - rf, height - bf],
        [lf, height - bf],
      ];
    default:
      return [
        [lf, tf],
        [ln, tn],
        [ln, height - bn],
        [lf, height - bf],
      ];
  }
}

function bandQuads(params: {
  sides: BorderSides;
  width: number;
  height: number;
  from: number;
  to: number;
  colorFor: (side: SideKey) => string;
}): Array<SideQuad> {
  const { sides, width, height, from, to, colorFor } = params;
  return SIDE_KEYS.filter((side) => sides[side].width > 0).map((side) => ({
    color: colorFor(side),
    points: bandPoints({ sides, width, height, side, from, to }),
  }));
}

/**
 * Chrome's dash fitting, measured off its raster: every dash is `dashLength`
 * long (`2 × width` for `dashed`, `width` for `dotted`), a dash lands in each
 * corner, and the gaps take up the slack — so the whole number of dashes is
 * chosen to leave a gap as close as possible to its nominal `width`.
 *
 * The exact fit `(length + width) / (dashLength + width)` is the count whose gap
 * would be exactly nominal; the gap shrinks as the count grows, so the winner is
 * whichever side of it lands closer, ties going to the denser one (measured: a
 * 92px side of a 6px `dashed` border takes 6 dashes, where 5 and 6 are equally
 * far off, and 8 dots where 9 would be nearer the nominal count but further from
 * the nominal gap).
 *
 * Returns each dash's `[start, end]` along the side's own axis, or `null` when
 * the side cannot fit two dashes or would need more than the node budget.
 * `length` is the side's *outer* extent, corner to corner — Chrome runs the
 * dashed line across the full box edge and clips it to the mitered trapezoid,
 * which is what {@link clipToHalfPlane} does below.
 */
function fitDashes(
  length: number,
  dashLength: number,
  width: number
): Array<readonly [number, number]> | null {
  if (dashLength <= 0 || length <= 0) {
    return null;
  }
  const gapFor = (count: number) => (length - count * dashLength) / (count - 1);
  const exact = (length + width) / (dashLength + width);
  const dense = Math.ceil(exact);
  const sparse = Math.max(2, dense - 1);
  const count =
    Math.abs(gapFor(dense) - width) <= Math.abs(gapFor(sparse) - width)
      ? dense
      : sparse;
  if (count < 2 || count > MAX_DASHES_PER_SIDE) {
    return null;
  }
  const gap = gapFor(count);
  if (gap <= 0) {
    return null;
  }
  const runs: Array<readonly [number, number]> = [];
  for (let i = 0; i < count; i++) {
    const start = i * (dashLength + gap);
    runs.push([start, start + dashLength]);
  }
  return runs;
}

/**
 * Sutherland–Hodgman clip of a convex polygon against the half-plane where
 * `distance` is non-negative, interpolating new vertices on the crossings.
 */
function clipToHalfPlane(
  points: ReadonlyArray<readonly [number, number]>,
  distance: (point: readonly [number, number]) => number
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const [index, current] of points.entries()) {
    const previous = points[(index + points.length - 1) % points.length];
    if (!previous) {
      continue;
    }
    const dCurrent = distance(current);
    const dPrevious = distance(previous);
    if (dCurrent >= 0 !== dPrevious >= 0) {
      const t = dPrevious / (dPrevious - dCurrent);
      out.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (dCurrent >= 0) {
      out.push(current);
    }
  }
  return out;
}

/** Which axis a side's dashes run along, and how long that run is. */
function sideAxis(
  side: SideKey,
  width: number,
  height: number
): { index: 0 | 1; length: number } {
  return side === "top" || side === "bottom"
    ? { index: 0, length: width }
    : { index: 1, length: height };
}

/** The center of a side's band, across its thickness. */
function sideBandCenter(
  sides: BorderSides,
  width: number,
  height: number,
  side: SideKey
): number {
  switch (side) {
    case "top":
      return sides.top.width / 2;
    case "bottom":
      return height - sides.bottom.width / 2;
    case "left":
      return sides.left.width / 2;
    default:
      return width - sides.right.width / 2;
  }
}

/**
 * One side of the border, painted according to its own style: a single
 * trapezoid for `solid`, two thirds-deep trapezoids for `double`, the trapezoid
 * cut into fitted dashes for `dashed`, and a row of round dots for `dotted`.
 *
 * A dash is the side's whole trapezoid clipped to the dash's span, so it keeps
 * CSS's 45° miter wherever it reaches a corner. Dots are drawn as circles
 * instead — Chrome rasterizes `dotted` with round caps — and are left unclipped,
 * since a dot inscribed in the corner square barely crosses the miter.
 */
function sidePieces(
  sides: BorderSides,
  width: number,
  height: number,
  side: SideKey
): Array<SidePiece> {
  const { color, style, width: sideWidth } = sides[side];
  const band = (from: number, to: number): SideQuad => ({
    color,
    points: bandPoints({ sides, width, height, side, from, to }),
  });

  if (style === "double") {
    return [band(0, 1 / 3), band(2 / 3, 1)];
  }
  if (style !== "dashed" && style !== "dotted") {
    return [band(0, 1)];
  }

  const axis = sideAxis(side, width, height);
  const dashLength =
    style === "dashed" ? sideWidth * DASH_LENGTH_RATIO : sideWidth;
  const runs = fitDashes(axis.length, dashLength, sideWidth);
  if (!runs) {
    return [band(0, 1)];
  }

  if (style === "dotted") {
    const center = sideBandCenter(sides, width, height, side);
    const radius = sideWidth / 2;
    return runs.map(([start]) => ({
      color,
      radius,
      cx: axis.index === 0 ? start + radius : center,
      cy: axis.index === 0 ? center : start + radius,
    }));
  }

  const full = band(0, 1).points;
  return runs
    .map(([start, end]) => ({
      color,
      points: clipToHalfPlane(
        clipToHalfPlane(full, (p) => p[axis.index] - start),
        (p) => end - p[axis.index]
      ),
    }))
    .filter((quad) => quad.points.length >= 3);
}

/**
 * True when every visible `dashed`/`dotted` side fits inside the node budget.
 *
 * Guards the uniform case: a border the frame's own dash pattern already draws
 * only benefits from being cut into per-side geometry if the geometry actually
 * gets drawn, and {@link fitDashes} falls back to a solid band when it does not.
 */
function everyPatternedSideFits(
  sides: BorderSides,
  width: number,
  height: number
): boolean {
  return SIDE_KEYS.filter((key) => sides[key].width > 0).every((key) => {
    const side = sides[key];
    if (side.style !== "dashed" && side.style !== "dotted") {
      return true;
    }
    const dashLength =
      side.style === "dashed" ? side.width * DASH_LENGTH_RATIO : side.width;
    const axis = sideAxis(key, width, height);
    return fitDashes(axis.length, dashLength, side.width) !== null;
  });
}

/**
 * True for a border every visible side of which is the same `dashed` or
 * `dotted` style in the same color. The frame's own dash pattern can draw those
 * — but Figma phases one pattern continuously around the whole box while Chrome
 * fits the dashes to each side, so the two drift apart. Painting the fitted
 * dashes as geometry keeps them in step.
 */
function isUniformPatternedBorder(sides: BorderSides): boolean {
  const visible = SIDE_KEYS.map((key) => sides[key]).filter((s) => s.width > 0);
  const first = visible[0];
  if (visible.length < 2 || !first) {
    return false;
  }
  if (first.style !== "dashed" && first.style !== "dotted") {
    return false;
  }
  return visible.every(
    (side) => side.style === first.style && side.color === first.color
  );
}

/** The whole border, painted side by side in each side's declared style. */
function borderPieces(
  sides: BorderSides,
  width: number,
  height: number
): Array<SidePiece> {
  return SIDE_KEYS.filter((side) => sides[side].width > 0).flatMap((side) =>
    sidePieces(sides, width, height, side)
  );
}

/**
 * The shaded bands of a 3D border. `inset`/`outset` shade the border as a
 * single band; `groove`/`ridge` cut it in half and shade the halves in opposite
 * directions, so they emit two trapezoids per side.
 */
function border3dQuads(
  sides: BorderSides,
  width: number,
  height: number,
  style: Border3dStyle
): Array<SideQuad> {
  const halves: ReadonlyArray<{
    half: "outer" | "inner";
    from: number;
    to: number;
  }> =
    style === "groove" || style === "ridge"
      ? [
          { half: "outer", from: 0, to: 0.5 },
          { half: "inner", from: 0.5, to: 1 },
        ]
      : [{ half: "outer", from: 0, to: 1 }];

  return halves.flatMap(({ half, from, to }) =>
    bandQuads({
      sides,
      width,
      height,
      from,
      to,
      colorFor: (side) =>
        border3dSideColor({ style, side, half, color: sides[side].color }),
    })
  );
}

/** The SVG path and frame-local bounding box of one painted piece. */
function pieceGeometry(piece: SidePiece): BorderPathPiece | null {
  if (isPath(piece)) {
    return piece;
  }
  if (isDot(piece)) {
    const { cx, cy, radius } = piece;
    // Two half-arcs: SVG cannot close a full circle in a single arc command.
    const path =
      `M${cx - radius} ${cy} ` +
      `A${radius} ${radius} 0 0 1 ${cx + radius} ${cy} ` +
      `A${radius} ${radius} 0 0 1 ${cx - radius} ${cy} Z`;
    return {
      path,
      minX: cx - radius,
      minY: cy - radius,
      spanX: radius * 2,
      spanY: radius * 2,
    };
  }

  const first = piece.points[0];
  if (!first) {
    return null;
  }
  const xs = piece.points.map((p) => p[0]);
  const ys = piece.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const path = `M${first[0]} ${first[1]} ${piece.points
    .slice(1)
    .map((p) => `L${p[0]} ${p[1]}`)
    .join(" ")} Z`;
  return {
    path,
    minX,
    minY,
    spanX: Math.max(...xs) - minX,
    spanY: Math.max(...ys) - minY,
  };
}

function pieceToVectorNode(params: {
  piece: SidePiece;
  guid: FigmaGuid;
  frameGuid: FigmaGuid;
  childIndex: number;
  registerBlob: (blob: FigmaBlob) => number;
}): FigmaVectorNodeChange | null {
  const { piece, guid, frameGuid, childIndex, registerBlob } = params;
  const fill = cssColorToFigmaColor(piece.color);
  if (!fill) {
    return null;
  }

  const geometry = pieceGeometry(piece);
  if (!geometry || geometry.spanX <= 0 || geometry.spanY <= 0) {
    return null;
  }
  const { path, minX, minY } = geometry;

  // `normalize` re-origins the network to (0,0); with no target dimensions the
  // network keeps its 1:1 pixel scale, so `figmaSize` is the quad's bbox and we
  // position the node at the bbox's frame-local top-left.
  const scaling = svgPathToVectorNetworkWithScaling(path, { normalize: true });
  const bytes = vectorNetworkToBytes(scaling.vectorNetwork);
  const blobIndex = registerBlob({ bytes: Array.from(bytes) });

  return {
    guid,
    phase: "CREATED",
    parentIndex: { guid: frameGuid, position: childIndex.toString() },
    type: "VECTOR",
    name: "Border",
    visible: true,
    opacity: 1,
    size: { x: scaling.figmaSize.x, y: scaling.figmaSize.y },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: minX,
      m10: 0.0,
      m11: 1.0,
      m12: minY,
    },
    strokeWeight: 0,
    strokeAlign: "CENTER",
    strokePaints: [],
    dashPattern: [],
    fillPaints: [createSolidPaint(fill.color, fill.opacity)],
    vectorData: {
      vectorNetworkBlob: blobIndex,
      normalizedSize: { x: scaling.figmaSize.x, y: scaling.figmaSize.y },
    },
    horizontalConstraint: "MIN",
    verticalConstraint: "MIN",
  };
}

/** Paint every piece as its own VECTOR child, or `null` if fewer than two land. */
function toVectorNodes(
  pieces: ReadonlyArray<SidePiece>,
  context: {
    frameGuid: FigmaGuid;
    createGuid: () => FigmaGuid;
    registerBlob: (blob: FigmaBlob) => number;
  }
): Array<FigmaVectorNodeChange> | null {
  const nodes: Array<FigmaVectorNodeChange> = [];
  for (const piece of pieces) {
    const node = pieceToVectorNode({
      piece,
      guid: context.createGuid(),
      frameGuid: context.frameGuid,
      childIndex: nodes.length,
      registerBlob: context.registerBlob,
    });
    if (node) {
      nodes.push(node);
    }
  }
  return nodes.length >= 2 ? nodes : null;
}

/**
 * Build per-side border VECTOR children, or `null` to keep the frame's single
 * stroke. Returns `null` when the sides share color and style and no 3D shading
 * applies, when fewer than two sides are visible, or when a corner radius is
 * present (rounded per-side borders are not representable as flat trapezoids).
 */
export function decomposePerSideBorder(params: {
  computedStyle: CSSStyleDeclaration;
  width: number;
  height: number;
  frameGuid: FigmaGuid;
  createGuid: () => FigmaGuid;
  registerBlob: (blob: FigmaBlob) => number;
}): Array<FigmaVectorNodeChange> | null {
  const { computedStyle, width, height, frameGuid, createGuid, registerBlob } =
    params;

  const sides = parseBorderSides(computedStyle);
  if (hasCornerRadius(computedStyle)) {
    const radius = uniformCornerRadius(computedStyle);
    const first = sides.top;
    if (!(radius && isUniformDashedBorder(sides))) {
      return null;
    }
    const rounded = roundedDashedBorderPieces({
      boxWidth: width,
      boxHeight: height,
      radius,
      width: first.width,
    });
    return rounded
      ? toVectorNodes(
          rounded.map((piece) => ({ ...piece, color: first.color })),
          { frameGuid, createGuid, registerBlob }
        )
      : null;
  }
  const style3d = uniformBorder3dStyle(sides);
  const patterned =
    isUniformPatternedBorder(sides) &&
    everyPatternedSideFits(sides, width, height);
  if (!(style3d || patterned || borderSidesRequireDecomposition(sides))) {
    return null;
  }
  const pieces = style3d
    ? border3dQuads(sides, width, height, style3d)
    : borderPieces(sides, width, height);

  return toVectorNodes(pieces, { frameGuid, createGuid, registerBlob });
}
