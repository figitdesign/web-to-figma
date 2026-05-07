import type { Position } from "../../dom";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import { parseOpacity } from "../../styles/opacity";
import type { FigmaBlob, FigmaGuid, FigmaVectorNodeChange } from "../../types";
import { shapeToPath } from "./shapes";
import { svgPathToVectorNetworkWithScaling } from "./vector-networks";
import { vectorNetworkToBytes } from "./vector-networks/encoder";
import type { WindingRule } from "./vector-networks/types";

/**
 * Parses SVG stroke-dasharray string into array of floats.
 * @param dashArray - SVG stroke-dasharray value (e.g., "5,5", "10 5 2 5", "10px 2px", "none")
 * @returns Array of floats or undefined if no dash pattern
 */
function parseDashArray(
  dashArray: string | undefined | null
): Array<number> | undefined {
  if (!dashArray || dashArray === "none" || dashArray === "0") {
    return;
  }

  // Split by comma or whitespace and convert to numbers
  const splitValues = dashArray.trim().split(/[\s,]+/);

  const values = splitValues
    .map((v) => {
      const cleanValue = v.trim().replace(/px$/i, "");
      return Number.parseFloat(cleanValue);
    })
    .filter((v) => !Number.isNaN(v) && v >= 0);

  if (values.length === 0) {
    return;
  }

  // If we have an even number of values and every second value (gaps) is 0,
  // this creates a solid line, so return undefined
  if (values.length >= 2) {
    const gapValues = values.filter((_, index) => index % 2 === 1);

    const hasOnlyZeroGaps = gapValues.every((gap) => gap === 0);

    if (hasOnlyZeroGaps) {
      return;
    }
  }

  return values;
}

/**
 * Parses SVG stroke-linecap value to Figma strokeCap
 * @param lineCap - SVG stroke-linecap value ("butt", "round", "square")
 * @returns Figma strokeCap value or undefined
 */
function parseStrokeCap(
  lineCap: string | undefined | null
): "NONE" | "ROUND" | "SQUARE" | undefined {
  if (!lineCap) {
    return;
  }

  const normalizedCap = lineCap.toLowerCase().trim();

  switch (normalizedCap) {
    case "butt":
      return "NONE";
    case "round":
      return "ROUND";
    case "square":
      return "SQUARE";
    default:
      return;
  }
}

/**
 * Parses SVG stroke-linejoin value to Figma strokeJoin
 * @param lineJoin - SVG stroke-linejoin value ("miter", "bevel", "round")
 * @returns Figma strokeJoin value or undefined
 */
function parseStrokeJoin(
  lineJoin: string | undefined | null
): "MITER" | "BEVEL" | "ROUND" | undefined {
  if (!lineJoin) {
    return;
  }

  const normalizedJoin = lineJoin.toLowerCase().trim();

  switch (normalizedJoin) {
    case "miter":
      return "MITER";
    case "bevel":
      return "BEVEL";
    case "round":
      return "ROUND";
    default:
      return;
  }
}

function parseWindingRule(
  ruleValue: string | undefined | null
): WindingRule | undefined {
  if (!ruleValue) {
    return;
  }

  const normalizedRule = ruleValue.toLowerCase().trim();

  switch (normalizedRule) {
    case "evenodd":
      return "ODD";
    case "nonzero":
      return "NONZERO";
    default:
      return;
  }
}

function getFillRule(
  element: SVGElement,
  computedStyle: CSSStyleDeclaration
): WindingRule {
  const fillRuleAttr = element.getAttribute("fill-rule");
  const fromFillRuleAttr = parseWindingRule(fillRuleAttr);
  if (fromFillRuleAttr) {
    return fromFillRuleAttr;
  }

  const clipRuleAttr = element.getAttribute("clip-rule");
  const fromClipRuleAttr = parseWindingRule(clipRuleAttr);
  if (fromClipRuleAttr) {
    return fromClipRuleAttr;
  }

  // Check parent elements for inherited attributes
  let parent = element.parentElement;
  while (parent && parent instanceof SVGElement) {
    const parentFillRule = parent.getAttribute("fill-rule");
    const fromParentFillRule = parseWindingRule(parentFillRule);
    if (fromParentFillRule) {
      return fromParentFillRule;
    }

    const parentClipRule = parent.getAttribute("clip-rule");
    const fromParentClipRule = parseWindingRule(parentClipRule);
    if (fromParentClipRule) {
      return fromParentClipRule;
    }

    parent = parent.parentElement;
  }

  const fromComputedFillRule = parseWindingRule(computedStyle.fillRule);
  if (fromComputedFillRule) {
    return fromComputedFillRule;
  }

  const fromComputedClipRule = parseWindingRule(computedStyle.clipRule);
  if (fromComputedClipRule) {
    return fromComputedClipRule;
  }

  return "NONZERO";
}

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  registerBlob: (blob: FigmaBlob) => number;
  inheritedProperties?: {
    svgViewbox?: {
      width: number;
      height: number;
    };
  };
};

export type SVGChildElement =
  | SVGPathElement
  | SVGCircleElement
  | SVGRectElement
  | SVGEllipseElement
  | SVGLineElement
  | SVGPolylineElement
  | SVGPolygonElement;

export function elementToVectorNodeChange(
  element: SVGChildElement,
  options: Params
): FigmaVectorNodeChange {
  const {
    guid,
    parentGuid,
    childIndex,
    position,
    registerBlob,
    inheritedProperties,
  } = options;

  const rect = element.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const computedStyle = window.getComputedStyle(element);

  const fillColor = cssColorToFigmaColor(computedStyle.fill);
  const fillOpacity = Number.parseFloat(computedStyle.fillOpacity);

  const strokeWidth = Number.parseFloat(computedStyle.strokeWidth) || 0;
  const strokeColor = cssColorToFigmaColor(computedStyle.stroke);
  const strokeOpacity = Number.parseFloat(computedStyle.strokeOpacity);

  const strokeLinecap = parseStrokeCap(computedStyle.strokeLinecap);
  const strokeLinejoin = parseStrokeJoin(computedStyle.strokeLinejoin);
  const strokeDasharray = parseDashArray(computedStyle.strokeDasharray);
  const fillRule = getFillRule(element, computedStyle);
  const opacity = parseOpacity(computedStyle.opacity);

  const path = shapeToPath(element);

  const scalingResult = svgPathToVectorNetworkWithScaling(path, {
    normalize: true,
    viewBoxWidth: inheritedProperties?.svgViewbox?.width,
    viewBoxHeight: inheritedProperties?.svgViewbox?.height,
    targetWidth: width,
    targetHeight: height,
    preserveAspectRatio: true,
    originalStrokeWeight: strokeWidth,
    originalStrokeDashArray: strokeDasharray?.join(","),
    fillRule,
  });

  const vectorNetwork = scalingResult.vectorNetwork;
  const vectorNetworkBytes = vectorNetworkToBytes(vectorNetwork);

  const blobIndex = registerBlob({ bytes: Array.from(vectorNetworkBytes) });

  const nodeChange: FigmaVectorNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "VECTOR",
    name: "Vector",
    visible: true,
    opacity,

    /* Size and Position */
    size: {
      x: scalingResult.figmaSize.x,
      y: scalingResult.figmaSize.y,
    },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
    },

    // /* Stroke */
    strokeWeight: scalingResult.scaledStrokeWeight,
    strokeAlign: "CENTER",
    strokeCap: strokeLinecap,
    strokeJoin: strokeLinejoin,
    strokePaints: strokeColor
      ? [createSolidPaint(strokeColor.color, strokeOpacity)]
      : [],
    dashPattern: strokeDasharray ?? [],

    /* Vector Data */
    vectorData: {
      vectorNetworkBlob: blobIndex,
      normalizedSize: {
        x: scalingResult.figmaSize.x,
        y: scalingResult.figmaSize.y,
      },
    },

    // /* Fill */
    fillPaints: fillColor
      ? [createSolidPaint(fillColor.color, fillOpacity)]
      : [],

    /* Other */
    horizontalConstraint: "SCALE",
    verticalConstraint: "SCALE",
  };

  return nodeChange;
}
