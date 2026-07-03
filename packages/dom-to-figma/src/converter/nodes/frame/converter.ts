import type { Position } from "../../dom";
import type { InferredChildStack } from "../../layout/infer";
import { inferAutoLayout } from "../../layout/infer";
import { getNodeNameFromElement } from "../../naming";
import {
  cssBackdropFilterToFigmaEffects,
  cssFilterToFigmaEffects,
} from "../../styles/blur";
import { parseBorderFromComputedStyle } from "../../styles/border";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import { cssBackgroundToFigmaPaints } from "../../styles/gradient";
import { parseOpacity } from "../../styles/opacity";
import { cssBoxShadowToFigmaEffects } from "../../styles/shadow";
import type {
  FigmaFrameNodeChange,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
} from "../../types";
import type { ConverterLayout } from "../../walk";

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
};

type FrameResult = {
  nodeChange: FigmaFrameNodeChange;
  textGradient?: Array<FigmaPaint>;
  /** Set when the frame became an inferred auto-layout stack, so the walker
   * can tell its children. */
  isAutoLayout: boolean;
  /** Per-child overrides from stack inference, for the walker to hand down. */
  childStackSpecs?: ReadonlyMap<Element, InferredChildStack>;
  /** Reversed flex direction: the walker emits children in visual order. */
  reverseChildren?: boolean;
};

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

  // Parse border information
  const borderProperties = parseBorderFromComputedStyle(computedStyle, {
    width,
    height,
  });

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

  // Combine all effects
  const effects = [...shadowEffects, ...filterEffects, ...backdropEffects];

  const { horizontalConstraint, verticalConstraint, positionOverride } =
    getPositioningInfo(element, rect, computedStyle);
  const finalPosition = positionOverride ?? position;

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

  // Add background-color first (bottom layer)
  if (backgroundColor) {
    fillPaints.push(
      createSolidPaint(backgroundColor.color, backgroundColor.opacity)
    );
  }

  // Add background-image on top (top layer)
  if (backgroundImage && backgroundImage !== "none") {
    const gradientPaints = cssBackgroundToFigmaPaints(backgroundImage);

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
    size: {
      x: width,
      y: height,
    },
    transform: {
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
    ...borderProperties,

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

  return {
    nodeChange,
    textGradient,
    isAutoLayout: inferred !== null,
    childStackSpecs: inferred?.children,
    reverseChildren: inferred?.reverseChildren,
  };
}
