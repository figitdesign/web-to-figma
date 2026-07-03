import type { FigmaGuid, FigmaSize, FigmaTransform } from "./core";
import type { FigmaEffect } from "./effects";
import type { FigmaStackMode } from "./layout";
import type { FigmaPaint } from "./paint";
import type {
  FigmaDerivedTextData,
  FigmaTextAlignHorizontal,
  FigmaTextCase,
  FigmaTextData,
  FigmaTextDecoration,
} from "./text";

// Base properties common to all nodes
type FigmaBaseNodeChange = {
  guid: FigmaGuid;
  phase: string;
  parentIndex?: {
    guid: FigmaGuid;
    position: string;
  };
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: string;
  size?: FigmaSize;
  transform?: FigmaTransform;
  mask?: boolean;
  maskType?: string;
  locked?: boolean;
  autoRename?: boolean;
};

// Text-specific properties
export type FigmaTextNodeChange = FigmaBaseNodeChange & {
  type: "TEXT";
  fontSize?: number;
  characters: string;
  textAlignHorizontal?: FigmaTextAlignHorizontal;
  textAlignVertical?: string;
  lineHeight?: {
    value: number;
    units: string;
  };
  fontName?: {
    family: string;
    style: string;
    postscript?: string;
  };
  textData?: FigmaTextData;
  derivedTextData?: FigmaDerivedTextData;
  textExplicitLayoutVersion?: number;
  emojiImageSet?: string;
  textDecorationSkipInk?: boolean;
  fontVariantCommonLigatures?: boolean;
  fontVariantContextualLigatures?: boolean;
  fontVariantDiscretionaryLigatures?: boolean;
  fontVariantHistoricalLigatures?: boolean;
  fontVariantOrdinal?: boolean;
  fontVariantSlashedZero?: boolean;
  fontVariantNumericFigure?: string;
  fontVariantNumericSpacing?: string;
  fontVariantNumericFraction?: string;
  fontVariantCaps?: string;
  fontVariantPosition?: string;
  letterSpacing?: {
    value: number;
    units: string;
  };
  fontVersion?: string;
  textUserLayoutVersion?: number;
  toggledOnOTFeatures?: Array<unknown>;
  toggledOffOTFeatures?: Array<unknown>;
  fontVariations?: Array<unknown>;
  textBidiVersion?: number;
  textTracking?: number;
  handleMirroring?: string;
  textAutoResize?: string;
  detachOpticalSizeFromFontSize?: boolean;
  textDecoration?: FigmaTextDecoration;
  textCase?: FigmaTextCase;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  fillPaints?: Array<FigmaPaint>;
  targetAspectRatio?: {
    value: {
      x: number;
      y: number;
    };
  };
};

// Frame-specific properties
export type FigmaFrameNodeChange = FigmaBaseNodeChange & {
  type: "FRAME";
  fillPaints?: Array<FigmaPaint>;
  strokePaints?: Array<FigmaPaint>;
  effects?: Array<FigmaEffect>;
  cornerRadius?: number;
  backgroundOpacity?: number;
  backgroundEnabled?: boolean;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: Array<number>;
  // Individual border weights
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderStrokeWeightsIndependent?: boolean;
  // Corner radius
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  rectangleCornerRadiiIndependent?: boolean;
  rectangleCornerToolIndependent?: boolean;
  proportionsConstrained?: boolean;
  bordersTakeSpace?: boolean;
  horizontalConstraint?: string;
  verticalConstraint?: string;
  // Auto-layout properties
  stackMode?: FigmaStackMode;
  stackSpacing?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPrimarySizing?: string;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackChildPrimaryGrow?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackChildAlignSelf?: string;
  stackPositioning?: string;
  stackWrap?: string;
  stackCounterSpacing?: number;
  stackReverseZIndex?: boolean;
  minSize?: object;
  maxSize?: object;
  miterLimit?: number;
  frameMaskDisabled?: boolean;
  resizeToFit?: boolean;
  exportBackgroundDisabled?: boolean;
  cornerSmoothing?: number;
  containerSupportsFillStrokeAndCorners?: boolean;
  stackCounterSizing?: string;
};

// Vector-specific properties
export type FigmaVectorNodeChange = FigmaBaseNodeChange & {
  type: "VECTOR";
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  fillPaints?: Array<FigmaPaint>;
  strokePaints?: Array<FigmaPaint>;
  dashPattern?: Array<number>;
  horizontalConstraint?: string;
  verticalConstraint?: string;
  effects?: Array<FigmaEffect>;
  vectorData?: {
    vectorNetworkBlob: number;
    normalizedSize: {
      x: number;
      y: number;
    };
  };
};

// Group-specific properties
export type FigmaGroupNodeChange = FigmaBaseNodeChange & {
  type: "GROUP";
};

// Canvas-specific properties
export type FigmaCanvasNodeChange = FigmaBaseNodeChange & {
  type: "CANVAS";
  backgroundOpacity?: number;
  backgroundEnabled?: boolean;
};

// Document-specific properties
export type FigmaDocumentNodeChange = FigmaBaseNodeChange & {
  type: "DOCUMENT";
};

// Rounded rectangle-specific properties
export type FigmaRoundedRectangleNodeChange = FigmaBaseNodeChange & {
  type: "ROUNDED_RECTANGLE";
  fillPaints?: Array<FigmaPaint>;
  strokePaints?: Array<FigmaPaint>;
  effects?: Array<FigmaEffect>;
  cornerRadius?: number;
  cornerSmoothing?: number;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: Array<number>;
  targetAspectRatio?: {
    value: {
      x: number;
      y: number;
    };
  };
};

// Union type for all node changes - this provides type safety!
export type FigmaNodeChange =
  | FigmaTextNodeChange
  | FigmaFrameNodeChange
  | FigmaVectorNodeChange
  | FigmaGroupNodeChange
  | FigmaCanvasNodeChange
  | FigmaDocumentNodeChange
  | FigmaRoundedRectangleNodeChange;
