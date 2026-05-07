import type { Position } from "../../dom";
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

type Constraints = {
  horizontalConstraint?: string;
  verticalConstraint?: string;
};

function getConstraintsFromPositioning(
  element: Element,
  elementRect: DOMRect,
  computedStyle: CSSStyleDeclaration
): Constraints {
  const position = computedStyle.position;
  const isPositioned = position === "fixed" || position === "absolute";

  if (!isPositioned) {
    return {};
  }

  // Get the containing block (parent for absolute, viewport for fixed)
  const isFixed = position === "fixed";
  const containingRect = isFixed
    ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
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

  return { horizontalConstraint, verticalConstraint };
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
};

type FrameResult = {
  nodeChange: FigmaFrameNodeChange;
  textGradient?: Array<FigmaPaint>;
};

export function elementToFrameNodeChange(
  element: Element,
  options: Params
): FrameResult {
  const { guid, parentGuid, childIndex, position } = options;

  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

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
  const borderProperties = parseBorderFromComputedStyle(computedStyle);

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

  const { horizontalConstraint, verticalConstraint } =
    getConstraintsFromPositioning(element, rect, computedStyle);

  const { fillsParentHeight, fillsParentWidth } = getFillProperties(
    element,
    rect
  );

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
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
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

    /* Auto Layout Child Properties */
    ...(fillsParentHeight && { stackChildPrimaryGrow: 1 }),
    ...(fillsParentWidth && { stackChildAlignSelf: "STRETCH" }),
  };

  return {
    nodeChange,
    textGradient,
  };
}
