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
 * The four CSS border trapezoids for a `width`×`height` border-box (INSIDE
 * stroke). Each side runs from its outer edge to the inner content edge; the
 * shared corner vertices `(l, t)`, `(width - r, t)`, … give the 45° miters.
 * Sides with zero width are omitted.
 */
function sideQuads(
  sides: BorderSides,
  width: number,
  height: number
): Array<SideQuad> {
  const t = sides.top.width;
  const r = sides.right.width;
  const b = sides.bottom.width;
  const l = sides.left.width;
  const innerRight = width - r;
  const innerBottom = height - b;

  const quads: Array<SideQuad> = [];
  if (t > 0) {
    quads.push({
      color: sides.top.color,
      points: [
        [0, 0],
        [width, 0],
        [innerRight, t],
        [l, t],
      ],
    });
  }
  if (r > 0) {
    quads.push({
      color: sides.right.color,
      points: [
        [width, 0],
        [width, height],
        [innerRight, innerBottom],
        [innerRight, t],
      ],
    });
  }
  if (b > 0) {
    quads.push({
      color: sides.bottom.color,
      points: [
        [l, innerBottom],
        [innerRight, innerBottom],
        [width, height],
        [0, height],
      ],
    });
  }
  if (l > 0) {
    quads.push({
      color: sides.left.color,
      points: [
        [0, 0],
        [l, t],
        [l, innerBottom],
        [0, height],
      ],
    });
  }
  return quads;
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
 * stroke. Returns `null` when the sides share color+style, when fewer than two
 * sides are visible, or when a corner radius is present (rounded per-side
 * colors are not representable as flat trapezoids).
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
  if (!borderSidesRequireDecomposition(sides)) {
    return null;
  }

  const nodes: Array<FigmaVectorNodeChange> = [];
  for (const quad of sideQuads(sides, width, height)) {
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
