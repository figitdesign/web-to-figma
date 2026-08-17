import type { FigmaPaint } from "../types";
import { createSolidPaint, cssColorToFigmaColor } from "./color";

/**
 * CSS `outline` — a ring drawn *outside* the border box, `outline-offset` away
 * from it, taking up no layout space.
 *
 * A Figma node carries one stroke, which the element's border (or a promoted
 * ring shadow) already owns, and that stroke hugs the box rather than standing
 * off from it. So the outline becomes its own node: an oversized child frame
 * with an INSIDE stroke, whose edges sit exactly where CSS paints the ring. The
 * frame converter builds the node; this module only reads the CSS.
 */
export type OutlineSpec = {
  /** Ring thickness (px) — `outline-width`. */
  width: number;
  /** Gap between the border box and the ring's inner edge (px). May be negative. */
  offset: number;
  strokePaints: Array<FigmaPaint>;
  /** `[dash, gap]` for a `dotted` outline, matching the border convention. */
  dashPattern?: Array<number>;
  /** `"ROUND"` for a `dotted` outline, so each dash renders as a round dot. */
  strokeCap?: string;
};

/**
 * Styles drawn as a plain ring. `auto` is Chrome's focus ring, which rasterizes
 * as a solid rounded outline, so it joins `solid` here. `dashed` is drawn solid
 * for the same reason borders are (see `parseUniformDashPattern`): Figma's
 * continuously-phased dashes drift out of step with Chrome's per-side fitting.
 * The remaining styles (`double`, `groove`, `ridge`, `inset`, `outset`) need
 * more than one ring or per-side shading and stay unconverted.
 */
const SOLID_OUTLINE_STYLES: ReadonlyArray<string> = ["auto", "solid", "dashed"];

/**
 * The outline ring for an element, or `undefined` when it has none (or one we
 * cannot draw as a single ring).
 */
export function parseOutlineFromComputedStyle(
  computedStyle: CSSStyleDeclaration
): OutlineSpec | undefined {
  const style = (computedStyle.outlineStyle || "none").trim();
  const isDotted = style === "dotted";
  if (!(isDotted || SOLID_OUTLINE_STYLES.includes(style))) {
    return;
  }

  const width = Number.parseFloat(computedStyle.outlineWidth || "0");
  if (!(Number.isFinite(width) && width > 0)) {
    return;
  }

  const color = cssColorToFigmaColor(computedStyle.outlineColor);
  if (!color || color.opacity === 0) {
    return;
  }

  const offset = Number.parseFloat(computedStyle.outlineOffset || "0") || 0;

  return {
    width,
    offset,
    strokePaints: [createSolidPaint(color.color, color.opacity)],
    ...(isDotted && {
      dashPattern: [width, width],
      strokeCap: "ROUND",
    }),
  };
}
