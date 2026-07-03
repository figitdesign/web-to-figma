import { sortNodesByStackingOrder } from "../dom";

/**
 * Auto-layout properties inferred from a flex container, phrased directly in
 * kiwi NodeChange fields. Returned only when the reconstructed geometry
 * matches what the browser actually laid out (see `verifyGeometry`), so
 * applying these to a frame never moves pixels — callers fall back to
 * absolute positioning (`stackMode: "NONE"`) on `null`.
 */
export type InferredStack = {
  stackMode: "HORIZONTAL" | "VERTICAL";
  stackSpacing: number;
  stackPrimaryAlignItems: StackJustifyValue;
  stackCounterAlignItems: StackAlignValue;
  /** Left padding. Includes the border width: Figma lays out from the frame
   * edge while CSS offsets children by border + padding. */
  stackHorizontalPadding: number;
  /** Top padding, border included. */
  stackVerticalPadding: number;
  stackPaddingRight: number;
  stackPaddingBottom: number;
};

type StackJustifyValue =
  | "MIN"
  | "CENTER"
  | "MAX"
  | "SPACE_BETWEEN"
  | "SPACE_EVENLY";
type StackAlignValue = "MIN" | "CENTER" | "MAX";

/** Max deviation (px) between reconstructed and measured child positions. */
const GEOMETRY_TOLERANCE = 0.6;

const JUSTIFY_MAP: Record<string, StackJustifyValue> = {
  normal: "MIN",
  "flex-start": "MIN",
  start: "MIN",
  left: "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  end: "MAX",
  right: "MAX",
  "space-between": "SPACE_BETWEEN",
  "space-evenly": "SPACE_EVENLY",
  // space-around has no Figma equivalent -> bail.
};

const ALIGN_MAP: Record<string, StackAlignValue> = {
  // `stretch`/`normal` only differ from `start` when a child has no explicit
  // cross size; geometry verification rejects the container in that case.
  normal: "MIN",
  stretch: "MIN",
  "flex-start": "MIN",
  start: "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  end: "MAX",
  // baseline needs font-metric math we don't model yet -> bail.
};

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Infer Figma auto-layout properties for an element, or return `null` when
 * the container isn't a flex layout we can reproduce exactly (then it stays
 * absolutely positioned, which is always safe).
 *
 * Phase-1 scope: single-line flex without grow/shrink effects, absolute
 * children, reordering, or baseline alignment.
 */
export function inferAutoLayout(element: Element): InferredStack | null {
  const style = window.getComputedStyle(element);

  if (style.display !== "flex" && style.display !== "inline-flex") {
    return null;
  }
  if (style.flexWrap !== "nowrap") {
    return null;
  }

  const direction = style.flexDirection;
  if (direction !== "row" && direction !== "column") {
    return null;
  }
  const isRow = direction === "row";

  const justify = JUSTIFY_MAP[style.justifyContent];
  const align = ALIGN_MAP[style.alignItems];
  if (!(justify && align)) {
    return null;
  }

  const children = layoutChildren(element);
  if (!children || children.length === 0) {
    return null;
  }

  // The walker emits children in stacking order and Figma lays a stack out in
  // child order, so a z-index reshuffle would change the layout order.
  const domOrder = Array.from(element.childNodes);
  const stackingOrder = sortNodesByStackingOrder(domOrder);
  if (domOrder.some((node, i) => node !== stackingOrder[i])) {
    return null;
  }

  const parentRect = element.getBoundingClientRect();
  const childRects: Array<Rect> = children.map((child) => {
    const rect = child.getBoundingClientRect();
    return {
      x: rect.left - parentRect.left,
      y: rect.top - parentRect.top,
      width: rect.width,
      height: rect.height,
    };
  });

  const paddings = {
    left: edge(style.borderLeftWidth) + edge(style.paddingLeft),
    top: edge(style.borderTopWidth) + edge(style.paddingTop),
    right: edge(style.borderRightWidth) + edge(style.paddingRight),
    bottom: edge(style.borderBottomWidth) + edge(style.paddingBottom),
  };

  // Spacing between adjacent children comes from measurement (covering gap
  // and margins alike); Figma has a single spacing value, so it must be
  // uniform. Negative values are fine — Figma supports them.
  const gaps: Array<number> = [];
  for (let i = 1; i < childRects.length; i += 1) {
    const prev = childRects[i - 1] as Rect;
    const next = childRects[i] as Rect;
    gaps.push(
      isRow ? next.x - (prev.x + prev.width) : next.y - (prev.y + prev.height)
    );
  }
  if (gaps.some((gap) => Math.abs(gap - (gaps[0] ?? 0)) > GEOMETRY_TOLERANCE)) {
    return null;
  }
  const spacing = round2(gaps[0] ?? 0);

  const spec: InferredStack = {
    stackMode: isRow ? "HORIZONTAL" : "VERTICAL",
    stackSpacing: spacing,
    stackPrimaryAlignItems: justify,
    stackCounterAlignItems: align,
    stackHorizontalPadding: round2(paddings.left),
    stackVerticalPadding: round2(paddings.top),
    stackPaddingRight: round2(paddings.right),
    stackPaddingBottom: round2(paddings.bottom),
  };

  const parentSize = { width: parentRect.width, height: parentRect.height };
  if (!verifyGeometry(spec, parentSize, childRects)) {
    return null;
  }

  return spec;
}

/**
 * The element children that participate in flex layout, or `null` when the
 * container holds something phase 1 doesn't model (absolutely positioned
 * children, text-node flex items, grow/shrink, `order`).
 */
function layoutChildren(element: Element): Array<Element> | null {
  // Non-empty direct text nodes become anonymous flex items we can't map to
  // a converted node yet.
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) {
      return null;
    }
  }

  const children: Array<Element> = [];
  for (const child of element.children) {
    const style = window.getComputedStyle(child);
    if (style.display === "none") {
      continue; // Takes no space and the walker skips it too.
    }
    if (style.position === "absolute" || style.position === "fixed") {
      return null; // Phase 3: stackPositioning ABSOLUTE.
    }
    if (Number.parseFloat(style.flexGrow) !== 0) {
      return null; // Phase 2: stackChildPrimaryGrow.
    }
    if (style.order !== "0") {
      return null; // Visual order differs from DOM order.
    }
    children.push(child);
  }
  return children;
}

/**
 * Reconstruct where Figma's auto-layout would place each child and compare
 * with the browser's actual geometry. Positions are relative to the parent
 * border box, matching how the converter positions children.
 */
function verifyGeometry(
  spec: InferredStack,
  parent: { width: number; height: number },
  childRects: ReadonlyArray<Rect>
): boolean {
  const isRow = spec.stackMode === "HORIZONTAL";
  const padLeading = isRow
    ? spec.stackHorizontalPadding
    : spec.stackVerticalPadding;
  const padTrailing = isRow ? spec.stackPaddingRight : spec.stackPaddingBottom;
  const padCross = isRow
    ? spec.stackVerticalPadding
    : spec.stackHorizontalPadding;
  const padCrossTrailing = isRow
    ? spec.stackPaddingBottom
    : spec.stackPaddingRight;

  const primarySize = (rect: Rect) => (isRow ? rect.width : rect.height);
  const crossSize = (rect: Rect) => (isRow ? rect.height : rect.width);

  const inner =
    (isRow ? parent.width : parent.height) - padLeading - padTrailing;
  const innerCross =
    (isRow ? parent.height : parent.width) - padCross - padCrossTrailing;
  const totalChildren = childRects.reduce((n, r) => n + primarySize(r), 0);
  const count = childRects.length;

  let spacing = spec.stackSpacing;
  let cursor = padLeading;
  switch (spec.stackPrimaryAlignItems) {
    case "CENTER":
      cursor += (inner - totalChildren - spacing * (count - 1)) / 2;
      break;
    case "MAX":
      cursor += inner - totalChildren - spacing * (count - 1);
      break;
    case "SPACE_BETWEEN":
      spacing = count > 1 ? (inner - totalChildren) / (count - 1) : 0;
      break;
    case "SPACE_EVENLY": {
      const gap = (inner - totalChildren) / (count + 1);
      spacing = gap;
      cursor += gap;
      break;
    }
    default:
      break;
  }

  for (const rect of childRects) {
    const expectedPrimary = cursor;
    let expectedCross = padCross;
    if (spec.stackCounterAlignItems === "CENTER") {
      expectedCross += (innerCross - crossSize(rect)) / 2;
    } else if (spec.stackCounterAlignItems === "MAX") {
      expectedCross += innerCross - crossSize(rect);
    }

    const actualPrimary = isRow ? rect.x : rect.y;
    const actualCross = isRow ? rect.y : rect.x;
    if (
      Math.abs(actualPrimary - expectedPrimary) > GEOMETRY_TOLERANCE ||
      Math.abs(actualCross - expectedCross) > GEOMETRY_TOLERANCE
    ) {
      return false;
    }
    cursor += primarySize(rect) + spacing;
  }

  return true;
}

function edge(value: string): number {
  return Number.parseFloat(value || "0") || 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
