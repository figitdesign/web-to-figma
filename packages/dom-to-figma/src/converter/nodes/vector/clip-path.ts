/**
 * @fileoverview SVG `clip-path` support.
 *
 * A clipped SVG shape becomes a clipping Figma frame sized to the clip shape's
 * bounding box, holding the shape itself. A non-rectangular clip additionally
 * gets an outline mask child cut from the clip shape, so the frame's own
 * rectangular clip is only ever the outer bound.
 */

import type { Position } from "../../dom";
import type { FigmaFrameNodeChange, FigmaGuid } from "../../types";
import type { SVGChildElement } from "./converter";

/** `url(#id)`, as written in the attribute or resolved by getComputedStyle. */
const CLIP_PATH_URL = /^url\(["']?#(.+?)["']?\)$/;

const CLIPPABLE_SHAPES = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SvgClip = {
  /** The single shape the referenced `<clipPath>` contains. */
  shape: SVGChildElement;
  /** The shape's bounding box in CSS pixels, i.e. `getBoundingClientRect` space. */
  rect: ScreenRect;
  /** An axis-aligned rectangle is reproduced exactly by the container frame's
   * own clipping, so it needs no mask child. */
  isRectangular: boolean;
};

function clipPathId(element: Element): string | null {
  const computed = window.getComputedStyle(element).clipPath;
  const raw = (
    computed && computed !== "none"
      ? computed
      : (element.getAttribute("clip-path") ?? "")
  ).trim();
  return CLIP_PATH_URL.exec(raw)?.[1] ?? null;
}

/** Maps a user-space bounding box through an unrotated CTM. */
function mapBBox(bbox: DOMRect, ctm: DOMMatrix): ScreenRect {
  const x1 = ctm.a * bbox.x + ctm.e;
  const x2 = ctm.a * (bbox.x + bbox.width) + ctm.e;
  const y1 = ctm.d * bbox.y + ctm.f;
  const y2 = ctm.d * (bbox.y + bbox.height) + ctm.f;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function isPlainRect(shape: SVGChildElement): boolean {
  if (shape.tagName.toLowerCase() !== "rect") {
    return false;
  }
  const rect = shape as SVGRectElement;
  return rect.rx.baseVal.value === 0 && rect.ry.baseVal.value === 0;
}

/**
 * Resolves an element's `clip-path: url(#id)` to the geometry of the clip
 * shape, or null when there is no clip or the clip is outside the modelled
 * subset (multiple shapes, `objectBoundingBox` units, transforms, rotation).
 * Returning null leaves the element unclipped, which is the old behaviour.
 */
export function resolveSvgClip(element: Element): SvgClip | null {
  const graphics = element as SVGGraphicsElement;
  if (typeof graphics.getScreenCTM !== "function") {
    return null;
  }

  const id = clipPathId(element);
  if (!id) {
    return null;
  }

  const clipPath = element.ownerDocument.getElementById(id);
  if (!clipPath || clipPath.tagName.toLowerCase() !== "clippath") {
    return null;
  }
  // Only one shape: sibling masks in Figma chain rather than union, so a
  // multi-shape clip cannot be reproduced by this shape.
  if (clipPath.children.length !== 1) {
    return null;
  }
  if (
    clipPath.getAttribute("clipPathUnits") === "objectBoundingBox" ||
    clipPath.getAttribute("transform")
  ) {
    return null;
  }

  const shape = clipPath.children[0] as SVGChildElement;
  if (
    !CLIPPABLE_SHAPES.has(shape.tagName.toLowerCase()) ||
    shape.getAttribute("transform")
  ) {
    return null;
  }

  // `clipPathUnits="userSpaceOnUse"` (the default) puts the clip in the user
  // space of the referencing element, which is what its screen CTM maps.
  // Rotation or skew would not survive the axis-aligned box math above.
  const ctm = graphics.getScreenCTM();
  if (!ctm || ctm.b !== 0 || ctm.c !== 0) {
    return null;
  }

  const rect = mapBBox(shape.getBBox(), ctm);
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return { shape, rect, isRectangular: isPlainRect(shape) };
}

type ClipFrameParams = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  size: { width: number; height: number };
};

/** The unpainted frame that clips a shape to its `clip-path`. */
export function clipFrameNodeChange(
  options: ClipFrameParams
): FigmaFrameNodeChange {
  const { guid, parentGuid, childIndex, position, size } = options;

  return {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "FRAME",
    name: "Clip",
    visible: true,
    opacity: 1,
    frameMaskDisabled: false,

    /* Size and Position */
    size: { x: size.width, y: size.height },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
    },

    /* Layout */
    stackMode: "NONE",

    /* Fill and Stroke */
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,

    /* Other */
    horizontalConstraint: "SCALE",
    verticalConstraint: "SCALE",
  };
}
