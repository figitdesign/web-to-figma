/**
 * Text Processing Types
 *
 * Consolidated type definitions for the text processing system.
 * Includes OpenType.js type re-exports, layout types, and processing interfaces.
 *
 * @module TextProcessingTypes
 */

// Re-export external types
export type {
  FigmaBlob,
  FigmaGuid,
  FigmaPaint,
} from "../../../types";
export type { FontProperties, LoadedFont } from "../primitives/font/loader";
// Font-related types
export type { FontMetrics } from "../primitives/font/metrics";
// Layout-related types
export type {
  AlignedLayout,
  AlignmentOptions,
  GlyphPosition,
  HorizontalAlignment,
  SpacingOptions,
} from "../primitives/layout/positioning";
export type {
  LinePosition,
  MultiLineLayout,
  WrappingOptions,
} from "../primitives/layout/wrapping";

import type { Font, Glyph } from "fontkit";
import type { ScalingOptions } from "../../vector/scaling";
// Import types for use in this module
import type { FontMetrics } from "../primitives/font/metrics";
import type {
  AlignedLayout,
  GlyphPosition,
  HorizontalAlignment,
  SpacingOptions,
} from "../primitives/layout/positioning";
import type { MultiLineLayout } from "../primitives/layout/wrapping";

export type OpenTypeFont = Font;
export type OpenTypeGlyph = Glyph;

/**
 * Normalized path command structure
 */
export type PathCommand = {
  type: "M" | "L" | "Q" | "C" | "Z";
  values: Array<number>;
};

/**
 * Bounding box for glyph measurements
 */
export type GlyphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

/**
 * Complete configuration options for text layout processing
 */
export type TextLayoutOptions = {
  /** Font size in pixels */
  fontSize: number;
  /** Spacing configuration options */
  spacing?: SpacingOptions;
  /** Horizontal text alignment */
  alignment?: HorizontalAlignment;
  /** Container width for wrapping and alignment */
  containerWidth?: number;
  /** Baseline Y position offset */
  baselineY?: number;
  /** Line height in pixels (overrides font metrics calculation if specified) */
  lineHeight?: number;
  /** Scaling options (fontSize excluded as it's specified separately) */
  scaling?: ScalingOptions;
  /** Text wrapping configuration */
  wrapping?: {
    enabled?: boolean;
    wordWrap?: boolean;
    breakWords?: boolean;
  };
};

/**
 * Complete processed text layout interface
 * Extends AlignedLayout with additional metadata
 */
export type ProcessedTextLayout = {
  /** Array of positioned glyphs with alignment applied (from AlignedLayout) */
  positions: Array<GlyphPosition>;
  /** Bounding box information (from AlignedLayout) */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Final baseline Y position (from AlignedLayout) */
  baseline: number;
  /** Font metrics used for layout */
  metrics: FontMetrics;
  /** Total width of the text */
  textWidth: number;
  /** Number of glyphs processed */
  glyphCount: number;
  /** Original layout options */
  options: TextLayoutOptions;
  /** Multi-line layout data (if applicable) */
  multiLineLayout?: MultiLineLayout;
  /** Whether this layout uses multiple lines */
  isMultiLine: boolean;
} & AlignedLayout;

// Builder-related types
export type { FigmaBaseline } from "../builders/baselines";
// CSS-related types
export type {
  LineHeightOptions,
  ParsedTextProperties,
} from "../primitives/css/parser";
// Glyph-related types
export type {
  GlyphData,
  GlyphProcessingOptions,
  ProcessedGlyphs,
} from "../primitives/glyph/processor";
