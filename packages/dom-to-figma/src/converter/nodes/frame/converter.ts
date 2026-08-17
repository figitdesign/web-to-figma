import type { Position } from "../../dom";
import { isElementNode, isTextEmpty, isTextNode } from "../../dom";
import type { InferredChildStack } from "../../layout/infer";
import { inferAutoLayout } from "../../layout/infer";
import { getNodeNameFromElement } from "../../naming";
import {
  cssBackdropFilterToFigmaEffects,
  cssFilterToFigmaEffects,
} from "../../styles/blur";
import type { BorderProperties, DoubleBorderSpec } from "../../styles/border";
import { parseBorderFromComputedStyle } from "../../styles/border";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import {
  applyCssColorMatrixFilters,
  hasColorMatrixFilter,
} from "../../styles/filter-color";
import { cssBackgroundToFigmaPaints } from "../../styles/gradient";
import { parseOpacity } from "../../styles/opacity";
import type { OutlineSpec } from "../../styles/outline";
import { parseOutlineFromComputedStyle } from "../../styles/outline";
import {
  cssBoxShadowToFigmaEffects,
  isPureRingShadow,
  ringShadowToStroke,
} from "../../styles/shadow";
import type {
  FigmaBlob,
  FigmaEffect,
  FigmaFrameNodeChange,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
  FigmaVectorNodeChange,
} from "../../types";
import type { FigmaSize, FigmaTransform } from "../../types/core";
import type { ConverterLayout } from "../../walk";
import { decomposePerSideBorder } from "./border-decomposition";

type PositioningResult = {
  horizontalConstraint?: string;
  verticalConstraint?: string;
  positionOverride?: Position;
};

function getPositioningInfo(
  element: Element,
  elementRect: DOMRect,
  computedStyle: CSSStyleDeclaration
): PositioningResult {
  const position = computedStyle.position;
  const isPositioned = position === "fixed" || position === "absolute";

  if (!isPositioned) {
    return {};
  }

  // Get the containing block (parent for absolute, viewport for fixed).
  // For fixed elements we need the viewport of the element's *own* window
  // (e.g. when converting an iframe's body, the iframe has its own innerWidth/
  // innerHeight that differ from the outer window).
  const isFixed = position === "fixed";
  const view = element.ownerDocument?.defaultView ?? window;
  const containingRect = isFixed
    ? { top: 0, bottom: view.innerHeight, left: 0, right: view.innerWidth }
    : element.parentElement?.getBoundingClientRect();

  if (!containingRect) {
    return {};
  }

  // Calculate distances from each edge
  const distanceFromTop = elementRect.top - containingRect.top;
  const distanceFromBottom = containingRect.bottom - elementRect.bottom;
  const distanceFromLeft = elementRect.left - containingRect.left;
  const distanceFromRight = containingRect.right - elementRect.right;

  // Anchor to whichever edge is closer
  const verticalConstraint =
    distanceFromBottom < distanceFromTop ? "MAX" : "MIN";
  const horizontalConstraint =
    distanceFromRight < distanceFromLeft ? "MAX" : "MIN";

  // For fixed elements, the default y/x (from getBoundingClientRect minus parent
  // rect) places them at their viewport position. When the Figma frame represents
  // the full document scroll height, an element anchored to the viewport bottom
  // (e.g. a bottom navbar) ends up in the middle of the frame. Realign it to the
  // far edge of the parent frame so the MAX constraint pins it correctly.
  let positionOverride: Position | undefined;
  if (isFixed) {
    const parentRect = element.parentElement?.getBoundingClientRect();
    if (parentRect) {
      const x =
        horizontalConstraint === "MAX"
          ? parentRect.width - elementRect.width - distanceFromRight
          : elementRect.left - parentRect.left;
      const y =
        verticalConstraint === "MAX"
          ? parentRect.height - elementRect.height - distanceFromBottom
          : elementRect.top - parentRect.top;
      positionOverride = { x, y };
    }
  }

  return { horizontalConstraint, verticalConstraint, positionOverride };
}

/**
 * A CSS `transform` (rotate/skew/scale) is invisible to `getBoundingClientRect`,
 * which returns the axis-aligned bounding box — so without this the node would
 * be a flattened, enlarged rectangle. Rebuild the node from its untransformed
 * size (`offsetWidth/Height`) plus a Figma matrix derived from the computed
 * transform, positioning the node's center at the element's center. Assumes the
 * default `transform-origin: center` (the untransformed center equals the
 * rendered bbox center for center-origin transforms).
 *
 * Leaf elements only: in Figma the matrix applies to the whole subtree, but
 * descendants are measured in transformed screen space (bounding-box diffs),
 * so a matrix on a parent would transform them a second time and their sizes
 * would be the enlarged bboxes. Until descendants are measured in the parent's
 * untransformed local space, a transformed element with convertible children
 * keeps the flattened-bbox behavior.
 */
function getTransformOverride(
  element: Element,
  rect: DOMRect,
  computedStyle: CSSStyleDeclaration
): { size: FigmaSize; transform: FigmaTransform } | null {
  const value = computedStyle.transform;
  if (!value || value === "none") {
    return null;
  }
  const matrix = new DOMMatrix(value);
  const { a, b, c, d } = matrix;
  // Pure translation (or identity) is already handled by positioning.
  if (!matrix.is2D || (a === 1 && b === 0 && c === 0 && d === 1)) {
    return null;
  }
  for (const child of element.childNodes) {
    if (isElementNode(child) || (isTextNode(child) && !isTextEmpty(child))) {
      return null;
    }
  }
  const el = element as HTMLElement;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!(width && height)) {
    return null;
  }
  const parentRect = element.parentElement?.getBoundingClientRect();
  const parentLeft = parentRect?.left ?? 0;
  const parentTop = parentRect?.top ?? 0;
  const centerX = rect.left + rect.width / 2 - parentLeft;
  const centerY = rect.top + rect.height / 2 - parentTop;
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    size: { x: width, y: height },
    transform: {
      m00: a,
      m01: c,
      m02: centerX - (a * halfW + c * halfH),
      m10: b,
      m11: d,
      m12: centerY - (b * halfW + d * halfH),
    },
  };
}

/**
 * Drop the single-stroke border fields so the frame paints no stroke — used
 * when a per-side-colored border is decomposed into child vectors instead.
 * Corner-radius fields are preserved (decomposition only runs when there is no
 * radius, so they are already zero/absent).
 */
function withoutFrameStroke(props: BorderProperties): BorderProperties {
  const {
    strokePaints: _paints,
    strokeWeight: _weight,
    borderTopWeight: _top,
    borderRightWeight: _right,
    borderBottomWeight: _bottom,
    borderLeftWeight: _left,
    borderStrokeWeightsIndependent: _independent,
    ...rest
  } = props;
  return { ...rest, strokeWeight: 0, strokePaints: [] };
}

function getFillProperties(element: Element, rect: DOMRect) {
  const parentElement = element.parentElement;
  const parentRect = parentElement?.getBoundingClientRect();

  return {
    fillsParentHeight:
      parentRect && Math.abs(rect.height - parentRect.height) < 1,
    fillsParentWidth: parentRect && Math.abs(rect.width - parentRect.width) < 1,
  };
}

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  layout?: ConverterLayout;
  /** True when the parent frame became an inferred auto-layout stack. */
  parentIsAutoLayout?: boolean;
  /** Fill/stretch overrides computed by the parent stack's inference. */
  childStackSpec?: InferredChildStack;
  /** Set for the converted root element only: the size of the paste-template
   * frame (a VERTICAL stack) that this element is a fill child of. */
  rootFill?: { width: number; height: number };
  /** Allocates guids/blobs for synthetic child nodes — per-side-colored border
   * vectors and a `double` border's inner line. Absent callers skip them. */
  createGuid?: () => FigmaGuid;
  registerBlob?: (blob: FigmaBlob) => number;
};

type FrameResult = {
  nodeChange: FigmaFrameNodeChange;
  /** Per-side border trapezoids emitted when the sides differ in color/style;
   * the walker paints them below the frame's real children. */
  borderChildren?: Array<FigmaVectorNodeChange>;
  textGradient?: Array<FigmaPaint>;
  /** Set when the frame became an inferred auto-layout stack, so the walker
   * can tell its children. */
  isAutoLayout: boolean;
  /** Per-child overrides from stack inference, for the walker to hand down. */
  childStackSpecs?: ReadonlyMap<Element, InferredChildStack>;
  /** Reversed flex direction: the walker emits children in visual order. */
  reverseChildren?: boolean;
  /** Synthetic child nodes the walker must emit as children of this frame
   * (e.g. a `double` border's inner line). */
  extraChildren?: Array<FigmaNodeChange>;
};

/**
 * The inner line of a CSS `double` border, as a stroked child frame inset from
 * the parent frame's edges. The parent's own stroke draws the outer line and
 * its fill shows through the gap; this node adds only the inner line, via an
 * INSIDE stroke over an empty fill. See {@link DoubleBorderSpec}.
 */
function buildDoubleBorderInnerLine(
  guid: FigmaGuid,
  parentGuid: FigmaGuid,
  parentSize: FigmaSize,
  parentCornerRadius: number | undefined,
  spec: DoubleBorderSpec
): FigmaFrameNodeChange {
  const { inset, lineWeight, strokePaints } = spec;
  const innerRadius =
    parentCornerRadius && parentCornerRadius > inset
      ? parentCornerRadius - inset
      : 0;
  return {
    guid,
    phase: "CREATED",
    parentIndex: { guid: parentGuid, position: "0" },
    type: "FRAME",
    name: "Border (inner)",
    visible: true,
    opacity: 1,
    frameMaskDisabled: true,
    size: { x: parentSize.x - inset * 2, y: parentSize.y - inset * 2 },
    transform: { m00: 1, m01: 0, m02: inset, m10: 0, m11: 1, m12: inset },
    stackMode: "NONE",
    fillPaints: [],
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    strokeWeight: lineWeight,
    strokePaints,
    ...(innerRadius > 0 && { cornerRadius: innerRadius }),
    effects: [],
    stackHorizontalPadding: 0,
    stackVerticalPadding: 0,
    stackPaddingRight: 0,
    stackPaddingBottom: 0,
  };
}

/**
 * A CSS `outline` as a child frame that overhangs its parent on every side.
 * The ring's inner edge sits `outline-offset` outside the border box, so the
 * child is grown by `offset + width` per side and draws an INSIDE stroke of
 * `width` over an empty fill — leaving the parent's own stroke free for the
 * border. See {@link OutlineSpec}.
 *
 * CSS keeps a sharp outline sharp and otherwise grows the radius with the ring,
 * so the outer corner radius is the border radius plus the ring's full standoff.
 */
function buildOutlineRing(
  guid: FigmaGuid,
  parentGuid: FigmaGuid,
  parentSize: FigmaSize,
  parentCornerRadius: number | undefined,
  spec: OutlineSpec
): FigmaFrameNodeChange {
  const { width, offset, strokePaints, dashPattern, strokeCap } = spec;
  const standoff = offset + width;
  const outerRadius =
    parentCornerRadius && parentCornerRadius > 0
      ? parentCornerRadius + standoff
      : 0;
  return {
    guid,
    phase: "CREATED",
    parentIndex: { guid: parentGuid, position: "0" },
    type: "FRAME",
    name: "Outline",
    visible: true,
    opacity: 1,
    frameMaskDisabled: true,
    size: {
      x: parentSize.x + standoff * 2,
      y: parentSize.y + standoff * 2,
    },
    transform: {
      m00: 1,
      m01: 0,
      m02: -standoff,
      m10: 0,
      m11: 1,
      m12: -standoff,
    },
    stackMode: "NONE",
    fillPaints: [],
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    strokeWeight: width,
    strokePaints,
    ...(dashPattern && { dashPattern }),
    ...(strokeCap && { strokeCap }),
    ...(outerRadius > 0 && { cornerRadius: outerRadius }),
    effects: [],
    stackHorizontalPadding: 0,
    stackVerticalPadding: 0,
    stackPaddingRight: 0,
    stackPaddingBottom: 0,
  };
}

export function elementToFrameNodeChange(
  element: Element,
  options: Params
): FrameResult {
  const {
    guid,
    parentGuid,
    childIndex,
    position,
    layout,
    parentIsAutoLayout,
    childStackSpec,
    rootFill,
    createGuid,
    registerBlob,
  } = options;

  // Inferred auto-layout, spread onto the node change last so it overrides
  // `stackMode: "NONE"` and the CSS-padding fields (inference folds borders
  // into padding). `null` means "keep absolute positioning" — always safe.
  const inferred = layout === "auto" ? inferAutoLayout(element) : null;

  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  // Inside auto-layout stacks the box edges drive sibling positions, so
  // ceiling fractional sizes would accumulate as visible drift there.
  const width = parentIsAutoLayout ? rect.width : Math.ceil(rect.width);
  const height = parentIsAutoLayout ? rect.height : Math.ceil(rect.height);

  const backgroundImage = computedStyle.backgroundImage;
  const backgroundColor = cssColorToFigmaColor(computedStyle.backgroundColor);
  const backgroundClip = computedStyle.backgroundClip;
  const isTextClipped = backgroundClip === "text";
  const overflow =
    computedStyle.overflow ||
    computedStyle.overflowX ||
    +computedStyle.overflowY;
  const hasOverflowHidden = overflow === "hidden";

  // Parse border information. `doubleBorder` is metadata for the synthetic
  // inner-line child below, not a Figma node field, so keep it out of the
  // properties spread onto the node change.
  const { doubleBorder, ...borderProperties } = parseBorderFromComputedStyle(
    computedStyle,
    { width, height }
  );

  const paddingTop = Number.parseFloat(computedStyle.paddingTop || "0");
  const paddingRight = Number.parseFloat(computedStyle.paddingRight || "0");
  const paddingBottom = Number.parseFloat(computedStyle.paddingBottom || "0");
  const paddingLeft = Number.parseFloat(computedStyle.paddingLeft || "0");

  const boxShadow = computedStyle.boxShadow;
  const backdropFilter = computedStyle.backdropFilter;
  const filter = computedStyle.filter;
  const opacity = parseOpacity(computedStyle.opacity);

  const shadowEffects = cssBoxShadowToFigmaEffects(boxShadow);
  const filterEffects = cssFilterToFigmaEffects(filter);
  const backdropEffects = cssBackdropFilterToFigmaEffects(backdropFilter);

  // A pure-ring box-shadow (`0 0 0 <spread>`) renders as nothing in Figma as a
  // DROP_SHADOW, but CSS draws a crisp solid ring. Promote the dominant (widest)
  // ring to an OUTSIDE stroke so Figma draws it following the corner radius.
  // A Figma node has a single stroke alignment/weight, so this only applies
  // when the element has no real CSS border (which owns the stroke); rings on
  // bordered elements stay DROP_SHADOWs. Any non-promoted shadows (blur/offset
  // shadows, narrower concentric rings) keep rendering as effects.
  const hasCssBorder = borderProperties.strokePaints.length > 0;
  let ringForStroke: FigmaEffect | null = null;
  if (!hasCssBorder) {
    for (const effect of shadowEffects) {
      if (
        isPureRingShadow(effect) &&
        (ringForStroke === null ||
          (effect.spread ?? 0) > (ringForStroke.spread ?? 0))
      ) {
        ringForStroke = effect;
      }
    }
  }
  const ringStroke = ringForStroke ? ringShadowToStroke(ringForStroke) : null;

  // Combine all effects, dropping only the ring promoted to a stroke.
  const effects = [
    ...shadowEffects.filter((effect) => effect !== ringForStroke),
    ...filterEffects,
    ...backdropEffects,
  ];

  const { horizontalConstraint, verticalConstraint, positionOverride } =
    getPositioningInfo(element, rect, computedStyle);
  const finalPosition = positionOverride ?? position;
  const transformOverride = getTransformOverride(element, rect, computedStyle);
  const frameSize: FigmaSize = transformOverride
    ? transformOverride.size
    : { x: width, y: height };

  // A frame carries a single stroke color, so four different border colors
  // collapse to one. When the sides disagree, decompose the border into a
  // filled trapezoid per side (exact CSS miters) and drop the frame stroke.
  // Skipped for inferred stacks (children would be laid out by the stack) and
  // transformed frames (size differs from the measured rect used for geometry).
  const borderChildren =
    createGuid && registerBlob && !(inferred || transformOverride)
      ? decomposePerSideBorder({
          computedStyle,
          width,
          height,
          frameGuid: guid,
          createGuid,
          registerBlob,
        })
      : null;
  const effectiveBorderProperties = borderChildren
    ? withoutFrameStroke(borderProperties)
    : borderProperties;

  const { fillsParentHeight, fillsParentWidth } = getFillProperties(
    element,
    rect
  );

  // Fill beats hug — but only when the fill actually resizes the node:
  // Figma keeps RESIZE_TO_FIT on a filled axis whose sizes already agree and
  // normalizes it to FIXED when they disagree (oracle batch-03). Children of
  // inferred stacks agree by construction (fill is only assigned when sizes
  // match), so the sole disagreement source is the converted root element
  // versus the paste-template frame it fills.
  if (inferred && rootFill) {
    const filledVertical =
      Boolean(fillsParentHeight) && Math.abs(rect.height - rootFill.height) > 1;
    const filledHorizontal =
      Boolean(fillsParentWidth) && Math.abs(rect.width - rootFill.width) > 1;
    const primaryIsHorizontal = inferred.stack.stackMode === "HORIZONTAL";
    if (
      inferred.stack.stackPrimarySizing === "RESIZE_TO_FIT" &&
      (primaryIsHorizontal ? filledHorizontal : filledVertical)
    ) {
      inferred.stack.stackPrimarySizing = "FIXED";
    }
    if (
      inferred.stack.stackCounterSizing === "RESIZE_TO_FIT" &&
      (primaryIsHorizontal ? filledVertical : filledHorizontal)
    ) {
      inferred.stack.stackCounterSizing = "FIXED";
    }
  }

  const fillPaints: Array<FigmaPaint> = [];
  let textGradient: Array<FigmaPaint> | undefined;

  // Add background-color first (bottom layer). CSS color-matrix filters
  // (grayscale/brightness/contrast/…) have no Figma effect, so bake them into
  // the fill — but only when the element's whole appearance IS that one solid
  // fill (a leaf with no children/text/background-image/border). A filter also
  // recolors content Figma paints separately (children, images, borders), so a
  // partial bake would be wrong; there, leaving it unfiltered is safer.
  if (backgroundColor) {
    const canBakeFilter =
      element.childElementCount === 0 &&
      !element.textContent?.trim() &&
      (!backgroundImage || backgroundImage === "none") &&
      borderProperties.strokePaints.length === 0 &&
      hasColorMatrixFilter(filter);
    const fillColor = canBakeFilter
      ? applyCssColorMatrixFilters(backgroundColor.color, filter)
      : backgroundColor.color;
    fillPaints.push(createSolidPaint(fillColor, backgroundColor.opacity));
  }

  // Add background-image on top (top layer)
  if (backgroundImage && backgroundImage !== "none") {
    const gradientPaints = cssBackgroundToFigmaPaints(backgroundImage, {
      width,
      height,
    });

    if (isTextClipped) {
      textGradient = gradientPaints;
    } else {
      fillPaints.push(...gradientPaints);
    }
  }

  // If there are shadows but no fills, add an almost transparent white fill
  // This is needed because Figma only shows shadows on frames with visible fills
  if (effects.length > 0 && fillPaints.length === 0) {
    fillPaints.push(createSolidPaint({ r: 1, g: 1, b: 1, a: 0.01 }, 0.01));
  }

  const nodeChange: FigmaNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "FRAME",
    name: getNodeNameFromElement(element),
    visible: true,
    opacity,
    frameMaskDisabled: !hasOverflowHidden,

    /* Size and Position */
    size: frameSize,
    transform: transformOverride
      ? transformOverride.transform
      : {
          m00: 1.0,
          m01: 0.0,
          m02: finalPosition.x,
          m10: 0.0,
          m11: 1.0,
          m12: finalPosition.y,
        },

    /* Layout */
    stackMode: "NONE",

    /* Fill, Stroke And Corner Radius */
    fillPaints,
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    ...effectiveBorderProperties,
    // A promoted pure-ring shadow overrides the (absent) border stroke with an
    // OUTSIDE stroke; keeps INSIDE/border strokes untouched when there is none.
    ...(ringStroke ?? {}),

    /* Effects */
    effects,

    /* Padding */
    stackHorizontalPadding: paddingLeft,
    stackVerticalPadding: paddingTop,
    stackPaddingRight: paddingRight,
    stackPaddingBottom: paddingBottom,

    /* Constraints */
    ...(horizontalConstraint && { horizontalConstraint }),
    ...(verticalConstraint && { verticalConstraint }),

    /* Auto Layout Child Properties. Inside an inferred stack the legacy fill
       heuristics are replaced by the parent inference's fill/stretch
       decisions (childStackSpec); applying the heuristics there would make
       Figma grow/stretch children and shift the layout. */
    ...(fillsParentHeight &&
      !parentIsAutoLayout && { stackChildPrimaryGrow: 1 }),
    ...(fillsParentWidth &&
      !parentIsAutoLayout && { stackChildAlignSelf: "STRETCH" }),
    ...(parentIsAutoLayout ? childStackSpec : undefined),

    /* Inferred Auto Layout (overrides stackMode and padding fields above) */
    ...inferred?.stack,
  };

  // Synthetic children the frame's single stroke can't express: a `double`
  // border's second concentric line, and an `outline` standing off outside the
  // box. Both are skipped when no guid allocator is available (e.g. the form
  // converter's frame).
  const extraChildren: Array<FigmaNodeChange> = [];
  if (doubleBorder && createGuid) {
    extraChildren.push(
      buildDoubleBorderInnerLine(
        createGuid(),
        guid,
        frameSize,
        borderProperties.cornerRadius,
        doubleBorder
      )
    );
  }
  const outline = parseOutlineFromComputedStyle(computedStyle);
  if (outline && createGuid) {
    extraChildren.push(
      buildOutlineRing(
        createGuid(),
        guid,
        frameSize,
        borderProperties.cornerRadius,
        outline
      )
    );
  }

  return {
    nodeChange,
    ...(borderChildren && { borderChildren }),
    textGradient,
    isAutoLayout: inferred !== null,
    childStackSpecs: inferred?.children,
    reverseChildren: inferred?.reverseChildren,
    ...(extraChildren.length > 0 && { extraChildren }),
  };
}
