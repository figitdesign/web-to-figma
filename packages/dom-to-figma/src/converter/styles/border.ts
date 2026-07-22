import type { FigmaColor, FigmaPaint } from "../types";
import { cssColorToFigmaColor } from "./color";

// Empirical fudge factor on top of the geometric `(1 + smoothing)` divisor —
// Figma renders softer than CSS at equal radius. Higher = tighter corners.
const SQUIRCLE_RADIUS_TIGHTEN = 1.125;

/**
 * A CSS `double` border drawn as two concentric lines. Figma has no
 * double-border primitive, so the frame's own stroke draws the OUTER line and
 * a synthetic inset child (see the frame converter) draws the INNER line, with
 * the frame's fill (the element background) showing through the gap between
 * them. Only present for uniform `double` borders wide enough to show a gap.
 */
export type DoubleBorderSpec = {
  /** Distance from each frame edge to the inner line's outer edge (px). */
  inset: number;
  /** Stroke weight of each line — outer and inner are equal (px). */
  lineWeight: number;
  /** Paints for the inner line: the same color as the frame's outer stroke. */
  strokePaints: Array<FigmaPaint>;
};

export type BorderProperties = {
  strokeWeight: number;
  strokePaints: Array<FigmaPaint>;
  cornerRadius?: number;
  cornerSmoothing?: number;
  // Conditional properties - only included when needed
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderStrokeWeightsIndependent?: boolean;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  rectangleCornerRadiiIndependent?: boolean;
  /** Present only for a uniform CSS `double` border. Not a Figma node field —
   * the frame converter consumes it and must not spread it onto a node. */
  doubleBorder?: DoubleBorderSpec;
};

/**
 * A CSS `double` border is two solid lines separated by a gap, each roughly a
 * third of the border width (Chrome renders 8px as 3px line / 2px gap / 3px
 * line). Detect the uniform case and split the width into equal lines; the
 * frame's stroke becomes the outer line and the returned spec drives the inner
 * line. Returns `undefined` for non-`double`, mixed, or too-narrow borders
 * (which Chrome itself collapses to a single solid line, so the existing solid
 * stroke already matches).
 */
function parseUniformDoubleBorder(
  computedStyle: CSSStyleDeclaration,
  width: number,
  strokePaints: Array<FigmaPaint>
): DoubleBorderSpec | undefined {
  const styles = [
    computedStyle.borderTopStyle,
    computedStyle.borderRightStyle,
    computedStyle.borderBottomStyle,
    computedStyle.borderLeftStyle,
  ];
  if (!styles.every((s) => s === "double") || strokePaints.length === 0) {
    return;
  }
  const lineWeight = Math.round(width / 3);
  const gap = width - 2 * lineWeight;
  if (lineWeight < 1 || gap < 1) {
    return;
  }
  return { inset: width - lineWeight, lineWeight, strokePaints };
}

// `squircle` ≡ `superellipse(4)` ≈ Figma's iOS smoothing (0.6).
// `superellipse(n)` interpolates: n=2 → 0, n=4 → 0.6, clamped to 1.
function cornerShapeToSmoothing(value: string): number | undefined {
  const v = value.trim().toLowerCase();
  if (!v || v === "round") {
    return 0;
  }
  if (v === "squircle") {
    return 0.6;
  }
  const m = v.match(/^superellipse\(\s*([\d.]+)\s*\)$/);
  if (m?.[1]) {
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 2) {
      return 0;
    }
    return Math.min(1, ((n - 2) / 2) * 0.6);
  }
  return;
}

// Figma's `cornerSmoothing` is a single per-node value, so we only emit one
// when all four CSS corners resolve to the same Figma-representable shape.
function parseCornerSmoothing(
  computedStyle: CSSStyleDeclaration
): number | undefined {
  const sides = [
    "corner-top-left-shape",
    "corner-top-right-shape",
    "corner-bottom-right-shape",
    "corner-bottom-left-shape",
  ];
  const values = sides.map((p) => computedStyle.getPropertyValue(p));
  if (values.every((v) => !v)) {
    return;
  }

  const smoothings = values.map((v) => cornerShapeToSmoothing(v));
  const first = smoothings[0];
  if (first === undefined) {
    return;
  }
  if (!smoothings.every((s) => s === first)) {
    return;
  }
  return first > 0 ? first : undefined;
}

/**
 * Parse CSS border properties and convert them to Figma border format
 *
 * @param computedStyle - The computed style of the element.
 * @param dimensions - Element box size, used to clamp squircle radii so
 *   `cornerSmoothing` has straight edge to extend into below Figma's pill cap.
 * @returns The border properties.
 */
export function parseBorderFromComputedStyle(
  computedStyle: CSSStyleDeclaration,
  dimensions?: { width: number; height: number }
): BorderProperties {
  // Check for borders on all sides
  const borderTopWidth = Number.parseFloat(computedStyle.borderTopWidth || "0");
  const borderRightWidth = Number.parseFloat(
    computedStyle.borderRightWidth || "0"
  );
  const borderBottomWidth = Number.parseFloat(
    computedStyle.borderBottomWidth || "0"
  );
  const borderLeftWidth = Number.parseFloat(
    computedStyle.borderLeftWidth || "0"
  );

  // Check if borders are independent (different widths on different sides)
  const hasIndependentBorders =
    borderTopWidth !== borderRightWidth ||
    borderTopWidth !== borderBottomWidth ||
    borderTopWidth !== borderLeftWidth;

  // Use the maximum border width as the base stroke weight for color
  const maxBorderWidth = Math.max(
    borderTopWidth,
    borderRightWidth,
    borderBottomWidth,
    borderLeftWidth
  );
  let strokeWeight = maxBorderWidth;

  // Get border color - prioritize the side with the largest border (Figma only supports one color for the stroke)
  const strokePaints: Array<FigmaPaint> = [];
  if (maxBorderWidth > 0) {
    let strokeColor: {
      color: FigmaColor;
      opacity: number;
    } | null = null;

    if (borderTopWidth === maxBorderWidth) {
      strokeColor = cssColorToFigmaColor(
        computedStyle.borderTopColor || computedStyle.borderColor
      );
    } else if (borderRightWidth === maxBorderWidth) {
      strokeColor = cssColorToFigmaColor(
        computedStyle.borderRightColor || computedStyle.borderColor
      );
    } else if (borderBottomWidth === maxBorderWidth) {
      strokeColor = cssColorToFigmaColor(
        computedStyle.borderBottomColor || computedStyle.borderColor
      );
    } else if (borderLeftWidth === maxBorderWidth) {
      strokeColor = cssColorToFigmaColor(
        computedStyle.borderLeftColor || computedStyle.borderColor
      );
    }

    if (strokeColor) {
      strokePaints.push({
        type: "SOLID",
        color: strokeColor.color,
        opacity: strokeColor.opacity,
        visible: true,
        blendMode: "NORMAL",
      });
    }
  }

  // A uniform CSS `double` border reduces the frame's own stroke to just the
  // outer line; the returned spec drives a synthetic inner-line child node.
  const doubleBorder =
    hasIndependentBorders || maxBorderWidth <= 0
      ? undefined
      : parseUniformDoubleBorder(computedStyle, maxBorderWidth, strokePaints);
  if (doubleBorder) {
    strokeWeight = doubleBorder.lineWeight;
  }

  // Parse border radius properties
  const rawBorderRadiusTopLeft = Number.parseFloat(
    computedStyle.borderTopLeftRadius || "0"
  );
  const rawBorderRadiusTopRight = Number.parseFloat(
    computedStyle.borderTopRightRadius || "0"
  );
  const rawBorderRadiusBottomLeft = Number.parseFloat(
    computedStyle.borderBottomLeftRadius || "0"
  );
  const rawBorderRadiusBottomRight = Number.parseFloat(
    computedStyle.borderBottomRightRadius || "0"
  );

  const cornerSmoothing = parseCornerSmoothing(computedStyle);

  // Scale the radius down so Figma's smoothed curve, which extends roughly
  // `r * (1 + s)` into each side, matches the CSS visual extent. Clamp at the
  // pill cap first so smoothing always has straight edge to extend into.
  const compensateRadius = (raw: number): number => {
    if (cornerSmoothing === undefined || cornerSmoothing <= 0) {
      return raw;
    }
    const clamped = dimensions
      ? Math.min(raw, Math.min(dimensions.width, dimensions.height) / 2)
      : raw;
    return clamped / ((1 + cornerSmoothing) * SQUIRCLE_RADIUS_TIGHTEN);
  };

  const borderRadiusTopLeft = compensateRadius(rawBorderRadiusTopLeft);
  const borderRadiusTopRight = compensateRadius(rawBorderRadiusTopRight);
  const borderRadiusBottomLeft = compensateRadius(rawBorderRadiusBottomLeft);
  const borderRadiusBottomRight = compensateRadius(rawBorderRadiusBottomRight);

  const hasIndependentCorners =
    borderRadiusTopLeft !== borderRadiusTopRight ||
    borderRadiusTopLeft !== borderRadiusBottomLeft ||
    borderRadiusTopLeft !== borderRadiusBottomRight;

  const borderProps: BorderProperties = {
    strokeWeight,
    strokePaints,
    cornerRadius: hasIndependentCorners ? undefined : borderRadiusTopLeft,
    ...(cornerSmoothing !== undefined && { cornerSmoothing }),
    ...(doubleBorder && { doubleBorder }),
  };

  // Only include individual border weights if they're different
  if (hasIndependentBorders) {
    borderProps.borderTopWeight = borderTopWidth;
    borderProps.borderRightWeight = borderRightWidth;
    borderProps.borderBottomWeight = borderBottomWidth;
    borderProps.borderLeftWeight = borderLeftWidth;
    borderProps.borderStrokeWeightsIndependent = hasIndependentBorders;
  }

  // Only include individual corner radii if they're different
  if (hasIndependentCorners) {
    borderProps.rectangleTopLeftCornerRadius = borderRadiusTopLeft;
    borderProps.rectangleTopRightCornerRadius = borderRadiusTopRight;
    borderProps.rectangleBottomLeftCornerRadius = borderRadiusBottomLeft;
    borderProps.rectangleBottomRightCornerRadius = borderRadiusBottomRight;
    borderProps.rectangleCornerRadiiIndependent = hasIndependentCorners;
  }

  return borderProps;
}
