import type { Border3dStyle } from "../../styles/border-3d";
import { border3dSideColor, isBorder3dStyle } from "../../styles/border-3d";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import type { FigmaBlob, FigmaGuid, FigmaVectorNodeChange } from "../../types";
import { svgPathToVectorNetworkWithScaling } from "../vector/vector-networks";
import { vectorNetworkToBytes } from "../vector/vector-networks/encoder";

/**
 * Per-side border color/style decomposition.
 *
 * A Figma frame carries a single `strokePaints` color, so one stroke cannot
 * express four different border colors. When the visible sides are all `solid`
 * but disagree on color, we drop the frame stroke and paint each side as its
 * own filled VECTOR trapezoid — matching CSS's 45° mitered corners exactly — so
 * red/green/blue/orange edges survive the round-trip instead of collapsing to
 * the top color. Uniform borders keep the single-stroke fast path.
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

/** A convex quad (frame-local coordinates) plus the CSS color to fill it. */
type SideQuad = {
  points: ReadonlyArray<readonly [number, number]>;
  color: string;
};

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
 * True when at least two visible sides (width > 0) are all `solid` but disagree
 * on color — the single frame stroke can only carry one color, so it collapses
 * them. Scoped to solid borders on purpose: dashed/dotted/double sides are a
 * separate concern and filling them as solid trapezoids would lose the pattern,
 * so those keep the existing single-stroke behavior. Uniform borders (and
 * single-visible-side borders) also return false and keep the fast path.
 */
function borderSidesRequireDecomposition(sides: BorderSides): boolean {
  const visible = SIDE_KEYS.map((key) => sides[key]).filter((s) => s.width > 0);
  if (visible.length < 2) {
    return false;
  }
  if (visible.some((side) => side.style !== "solid")) {
    return false;
  }
  const first = visible[0];
  if (!first) {
    return false;
  }
  return visible.some((side) => side.color !== first.color);
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
function bandQuads(params: {
  sides: BorderSides;
  width: number;
  height: number;
  from: number;
  to: number;
  colorFor: (side: SideKey) => string;
}): Array<SideQuad> {
  const { sides, width, height, from, to, colorFor } = params;
  // Corner miters at the band's outer depth (`f`) and inner depth (`n`).
  const tf = sides.top.width * from;
  const rf = sides.right.width * from;
  const bf = sides.bottom.width * from;
  const lf = sides.left.width * from;
  const tn = sides.top.width * to;
  const rn = sides.right.width * to;
  const bn = sides.bottom.width * to;
  const ln = sides.left.width * to;

  const quads: Array<SideQuad> = [];
  if (sides.top.width > 0) {
    quads.push({
      color: colorFor("top"),
      points: [
        [lf, tf],
        [width - rf, tf],
        [width - rn, tn],
        [ln, tn],
      ],
    });
  }
  if (sides.right.width > 0) {
    quads.push({
      color: colorFor("right"),
      points: [
        [width - rf, tf],
        [width - rf, height - bf],
        [width - rn, height - bn],
        [width - rn, tn],
      ],
    });
  }
  if (sides.bottom.width > 0) {
    quads.push({
      color: colorFor("bottom"),
      points: [
        [ln, height - bn],
        [width - rn, height - bn],
        [width - rf, height - bf],
        [lf, height - bf],
      ],
    });
  }
  if (sides.left.width > 0) {
    quads.push({
      color: colorFor("left"),
      points: [
        [lf, tf],
        [ln, tn],
        [ln, height - bn],
        [lf, height - bf],
      ],
    });
  }
  return quads;
}

/** The whole border, one trapezoid per side, each in its declared color. */
function sideQuads(
  sides: BorderSides,
  width: number,
  height: number
): Array<SideQuad> {
  return bandQuads({
    sides,
    width,
    height,
    from: 0,
    to: 1,
    colorFor: (side) => sides[side].color,
  });
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

function quadToVectorNode(params: {
  quad: SideQuad;
  guid: FigmaGuid;
  frameGuid: FigmaGuid;
  childIndex: number;
  registerBlob: (blob: FigmaBlob) => number;
}): FigmaVectorNodeChange | null {
  const { quad, guid, frameGuid, childIndex, registerBlob } = params;
  const fill = cssColorToFigmaColor(quad.color);
  if (!fill) {
    return null;
  }

  const xs = quad.points.map((p) => p[0]);
  const ys = quad.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  if (Math.max(...xs) - minX <= 0 || Math.max(...ys) - minY <= 0) {
    return null;
  }

  const first = quad.points[0];
  if (!first) {
    return null;
  }
  const path = `M${first[0]} ${first[1]} ${quad.points
    .slice(1)
    .map((p) => `L${p[0]} ${p[1]}`)
    .join(" ")} Z`;

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

/**
 * Build per-side border VECTOR children, or `null` to keep the frame's single
 * stroke. Returns `null` when the sides share color+style and no 3D shading
 * applies, when fewer than two sides are visible, or when a corner radius is
 * present (rounded per-side colors are not representable as flat trapezoids).
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

  if (hasCornerRadius(computedStyle)) {
    return null;
  }
  const sides = parseBorderSides(computedStyle);
  const style3d = uniformBorder3dStyle(sides);
  if (!(style3d || borderSidesRequireDecomposition(sides))) {
    return null;
  }
  const quads = style3d
    ? border3dQuads(sides, width, height, style3d)
    : sideQuads(sides, width, height);

  const nodes: Array<FigmaVectorNodeChange> = [];
  for (const quad of quads) {
    const node = quadToVectorNode({
      quad,
      guid: createGuid(),
      frameGuid,
      childIndex: nodes.length,
      registerBlob,
    });
    if (node) {
      nodes.push(node);
    }
  }

  return nodes.length >= 2 ? nodes : null;
}
