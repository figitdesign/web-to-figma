/**
 * @fileoverview Vector network scaling utilities.
 *
 * This module provides comprehensive scaling functionality for vector networks,
 * similar to SVG viewBox behavior. It handles proportional scaling while
 * maintaining visual fidelity of strokes, dash patterns, and geometric proportions.
 */

import type { VectorNetwork } from "../vector-networks/types";
import type { Bounds } from "./bounds";
import { calculateBounds } from "./bounds";
import { scaleDashArray, scaleStrokeWeight } from "./dash-scaler";
import {
  scaleVectorNetwork as applyScaling,
  copyVectorNetwork,
} from "./network-scaler";
import type { ScaleFactors } from "./scale-factors";
import { calculateScaleFactors, getAverageScaleFactor } from "./scale-factors";

export type ScalingOptions = {
  /** Target width for the scaled vector */
  targetWidth?: number;
  /** Target height for the scaled vector */
  targetHeight?: number;
  /** Maintain aspect ratio when scaling */
  preserveAspectRatio?: boolean;
  /** Original stroke weight to scale (if provided) */
  originalStrokeWeight?: number;
  /** Original stroke dash array to scale (if provided) */
  originalStrokeDashArray?: string;
};

export type ScaledVectorResult = {
  /** The scaled vector network */
  vectorNetwork: VectorNetwork;
  /** Original bounding box */
  originalBounds: Bounds;
  /** Final size for Figma node */
  figmaSize: {
    x: number;
    y: number;
  };
  /** Scale factors applied */
  scaleFactors: ScaleFactors;
  /** Scaled stroke weight (if provided) */
  scaledStrokeWeight?: number;
  /** Scaled stroke dash array (if provided) */
  scaledStrokeDashArray?: string;
};

/**
 * Scales a vector network to fit target dimensions
 * Similar to how SVG viewBox scaling works
 */
export function scaleVectorNetwork(
  vectorNetwork: VectorNetwork,
  options: ScalingOptions
): ScaledVectorResult {
  const {
    targetWidth,
    targetHeight,
    preserveAspectRatio = true,
    originalStrokeWeight,
    originalStrokeDashArray,
  } = options;

  // Calculate original bounds
  const originalBounds = calculateBounds(vectorNetwork.vertices);

  // If no scaling needed, return as-is
  if (!(targetWidth || targetHeight)) {
    return {
      vectorNetwork: copyVectorNetwork(vectorNetwork),
      originalBounds,
      figmaSize: { x: originalBounds.width, y: originalBounds.height },
      scaleFactors: { x: 1, y: 1 },
    };
  }

  // Calculate scale factors
  const scaleFactors = calculateScaleFactors(originalBounds, {
    targetWidth,
    targetHeight,
    preserveAspectRatio,
  });

  // Apply scaling to the vector network
  const scaledNetwork = applyScaling(vectorNetwork, scaleFactors);

  // Calculate final bounds after scaling
  const finalBounds = calculateBounds(scaledNetwork.vertices);

  // Scale stroke properties if provided
  const avgScaleFactor = getAverageScaleFactor(scaleFactors);

  let scaledStrokeWeight: number | undefined;
  if (originalStrokeWeight !== undefined) {
    scaledStrokeWeight = scaleStrokeWeight(
      originalStrokeWeight,
      avgScaleFactor
    );
  }

  let scaledStrokeDashArray: string | undefined;
  if (originalStrokeDashArray) {
    scaledStrokeDashArray = scaleDashArray(
      originalStrokeDashArray,
      avgScaleFactor
    );
  }

  return {
    vectorNetwork: scaledNetwork,
    originalBounds,
    figmaSize: {
      x: finalBounds.width,
      y: finalBounds.height,
    },
    scaleFactors,
    scaledStrokeWeight,
    scaledStrokeDashArray,
  };
}
