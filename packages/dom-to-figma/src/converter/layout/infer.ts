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
  /** Sizing modes must always be explicit: pasting a stack without them makes
   * Figma hug-to-content on the primary axis, shrinking the frame
   * (established by oracle batch-01). RESIZE_TO_FIT (hug) is emitted only
   * when the CSS declares a content-driven size AND the measured frame size
   * equals the content size, so the paste-time hug is a no-op. */
  stackPrimarySizing: StackSizingValue;
  stackCounterSizing: StackSizingValue;
  /** Left padding. Includes the border width: Figma lays out from the frame
   * edge while CSS offsets children by border + padding. */
  stackHorizontalPadding: number;
  /** Top padding, border included. */
  stackVerticalPadding: number;
  stackPaddingRight: number;
  stackPaddingBottom: number;
};

/** Auto-layout child overrides, keyed by child element by `inferAutoLayout`. */
export type InferredChildStack = {
  /** flex-grow child whose size matches Figma's fill-container distribution. */
  stackChildPrimaryGrow?: 1;
  /** Child stretched across the counter axis with no explicit cross size. */
  stackChildAlignSelf?: "STRETCH";
};

export type InferredAutoLayout = {
  stack: InferredStack;
  /** Per-child overrides; children not in the map get fixed sizing. */
  children: ReadonlyMap<Element, InferredChildStack>;
};

type StackJustifyValue = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
type StackAlignValue = "MIN" | "CENTER" | "MAX";
type StackSizingValue = "FIXED" | "RESIZE_TO_FIT";

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
  // The kiwi enum has SPACE_EVENLY but Figma's engine renders it as
  // space-between (oracle batch-01). With spacing measured from real rects,
  // CENTER reproduces both space-evenly (leading gap = g) and space-around
  // (leading gap = g/2) exactly; verifyGeometry guards the equivalence.
  "space-evenly": "CENTER",
  "space-around": "CENTER",
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
 * Out of scope (bails): wrapping, reverse directions, absolute children,
 * text-node flex items, `order`, z-index reordering, baseline alignment.
 */
export function inferAutoLayout(element: Element): InferredAutoLayout | null {
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
    stackPrimarySizing: "FIXED",
    stackCounterSizing: "FIXED",
    stackHorizontalPadding: round2(paddings.left),
    stackVerticalPadding: round2(paddings.top),
    stackPaddingRight: round2(paddings.right),
    stackPaddingBottom: round2(paddings.bottom),
  };

  const parentSize = { width: parentRect.width, height: parentRect.height };
  if (!verifyGeometry(spec, parentSize, childRects)) {
    return null;
  }

  applySizingModes({
    element,
    style,
    spec,
    parent: parentSize,
    children,
    childRects,
    isRow,
  });

  return {
    stack: spec,
    children: inferChildOverrides({
      element,
      children,
      childRects,
      parentStyle: style,
      spec,
      parentSize,
      isRow,
    }),
  };
}

/**
 * Upgrade FIXED to RESIZE_TO_FIT (hug) per axis when the CSS declares a
 * content-driven size AND the measured frame size equals the content size —
 * so Figma's paste-time hug is provably a no-op.
 *
 * Primary hug is never emitted for SPACE_BETWEEN containers or when a child
 * grows: in both cases the measured spacing/child sizes embed the free
 * space, making "content == frame" hold vacuously.
 */
function applySizingModes(options: {
  element: Element;
  style: CSSStyleDeclaration;
  spec: InferredStack;
  parent: { width: number; height: number };
  children: ReadonlyArray<Element>;
  childRects: ReadonlyArray<Rect>;
  isRow: boolean;
}) {
  const { element, style, spec, parent, children, childRects, isRow } = options;
  const spacing = spec.stackSpacing;
  const count = childRects.length;
  const primaryContent =
    childRects.reduce((n, r) => n + (isRow ? r.width : r.height), 0) +
    spacing * (count - 1) +
    (isRow
      ? spec.stackHorizontalPadding + spec.stackPaddingRight
      : spec.stackVerticalPadding + spec.stackPaddingBottom);
  const crossContent =
    Math.max(...childRects.map((r) => (isRow ? r.height : r.width))) +
    (isRow
      ? spec.stackVerticalPadding + spec.stackPaddingBottom
      : spec.stackHorizontalPadding + spec.stackPaddingRight);

  const primaryDriven = isContentDrivenSize(
    element,
    style,
    isRow ? "width" : "height"
  );
  const crossDriven = isContentDrivenSize(
    element,
    style,
    isRow ? "height" : "width"
  );
  const primarySize = isRow ? parent.width : parent.height;
  const crossSize = isRow ? parent.height : parent.width;

  const hasGrower = children.some(
    (child) => Number.parseFloat(window.getComputedStyle(child).flexGrow) > 0
  );
  const distributesFreeSpace =
    spec.stackPrimaryAlignItems === "SPACE_BETWEEN" || hasGrower;

  if (
    primaryDriven &&
    !distributesFreeSpace &&
    Math.abs(primarySize - primaryContent) <= GEOMETRY_TOLERANCE
  ) {
    spec.stackPrimarySizing = "RESIZE_TO_FIT";
  }
  if (crossDriven && Math.abs(crossSize - crossContent) <= GEOMETRY_TOLERANCE) {
    spec.stackCounterSizing = "RESIZE_TO_FIT";
  }
}

/**
 * Per-child fill/stretch overrides.
 *
 * Grow: flex-grow children map to Figma's fill-container only when their
 * measured sizes match Figma's model (fill children split the leftover space
 * equally, with no flex-basis notion). Otherwise they stay fixed at their
 * final size — geometry is identical either way; only resize behavior
 * differs.
 *
 * Stretch: children whose resolved align-self is stretch, with no explicit
 * cross size, and whose measured cross size fills the container.
 */
function inferChildOverrides(options: {
  element: Element;
  children: ReadonlyArray<Element>;
  childRects: ReadonlyArray<Rect>;
  parentStyle: CSSStyleDeclaration;
  spec: InferredStack;
  parentSize: { width: number; height: number };
  isRow: boolean;
}): ReadonlyMap<Element, InferredChildStack> {
  const { children, childRects, parentStyle, spec, parentSize, isRow } =
    options;
  const overrides = new Map<Element, InferredChildStack>();

  const inner =
    (isRow ? parentSize.width : parentSize.height) -
    (isRow
      ? spec.stackHorizontalPadding + spec.stackPaddingRight
      : spec.stackVerticalPadding + spec.stackPaddingBottom);
  const innerCross =
    (isRow ? parentSize.height : parentSize.width) -
    (isRow
      ? spec.stackVerticalPadding + spec.stackPaddingBottom
      : spec.stackHorizontalPadding + spec.stackPaddingRight);

  const primaryOf = (rect: Rect) => (isRow ? rect.width : rect.height);
  const crossOf = (rect: Rect) => (isRow ? rect.height : rect.width);

  const styles = children.map((child) => window.getComputedStyle(child));
  const growers = children.filter(
    (_, i) => Number.parseFloat((styles[i] as CSSStyleDeclaration).flexGrow) > 0
  );

  if (growers.length > 0) {
    const fixedTotal = children.reduce(
      (n, child, i) =>
        growers.includes(child) ? n : n + primaryOf(childRects[i] as Rect),
      0
    );
    const fillShare =
      (inner - fixedTotal - spec.stackSpacing * (children.length - 1)) /
      growers.length;
    const matchesFigmaFill = children.every(
      (child, i) =>
        !growers.includes(child) ||
        Math.abs(primaryOf(childRects[i] as Rect) - fillShare) <=
          GEOMETRY_TOLERANCE
    );
    if (matchesFigmaFill) {
      for (const child of growers) {
        overrides.set(child, { stackChildPrimaryGrow: 1 });
      }
    }
  }

  children.forEach((child, i) => {
    const childStyle = styles[i] as CSSStyleDeclaration;
    const alignSelf =
      childStyle.alignSelf === "auto" || childStyle.alignSelf === "normal"
        ? parentStyle.alignItems
        : childStyle.alignSelf;
    const stretches = alignSelf === "stretch" || alignSelf === "normal";
    const crossProp = isRow ? "height" : "width";
    if (
      stretches &&
      hasContentSizedKeyword(child, crossProp) &&
      Math.abs(crossOf(childRects[i] as Rect) - innerCross) <=
        GEOMETRY_TOLERANCE
    ) {
      overrides.set(child, {
        ...overrides.get(child),
        stackChildAlignSelf: "STRETCH",
      });
    }
  });

  return overrides;
}

const CONTENT_SIZED_KEYWORDS = new Set([
  "auto",
  "min-content",
  "max-content",
  "fit-content",
]);

/**
 * Whether the CSS declares this axis as content-sized (`auto`,
 * `fit-content`, ...) rather than a length/percentage. Uses the Typed OM
 * (`computedStyleMap`), which preserves keywords that `getComputedStyle`
 * resolves to used pixel values; browsers without it get `false`, degrading
 * to FIXED sizing everywhere.
 */
function hasContentSizedKeyword(
  element: Element,
  property: "width" | "height"
): boolean {
  if (typeof element.computedStyleMap !== "function") {
    return false;
  }
  const value = element.computedStyleMap().get(property);
  // The keyword class must come from the element's own realm: for elements
  // inside iframes, an instanceof against this window's CSSKeywordValue is
  // always false.
  const KeywordValue = element.ownerDocument?.defaultView?.CSSKeywordValue;
  return (
    KeywordValue !== undefined &&
    value instanceof KeywordValue &&
    CONTENT_SIZED_KEYWORDS.has(value.value)
  );
}

/**
 * Whether `auto` on this axis actually means shrink-to-content:
 * - `width: auto` on a block fills the parent; on a flex item it is
 *   content-sized along the parent's main axis but STRETCH on the cross axis
 *   (unless align-self opts out). Shrink-wrap contexts (inline-flex, floats,
 *   absolute positioning) are content-sized.
 * - `height: auto` is content-driven in normal flow; inside a flex row it is
 *   the cross axis and stretches by default, like width in a column.
 */
function isContentDrivenSize(
  element: Element,
  style: CSSStyleDeclaration,
  property: "width" | "height"
): boolean {
  if (!hasContentSizedKeyword(element, property)) {
    return false;
  }

  const parent = element.parentElement;
  const parentStyle = parent ? window.getComputedStyle(parent) : null;
  const parentIsFlex = parentStyle?.display.includes("flex") ?? false;

  if (parentIsFlex && parentStyle) {
    const parentIsRow = parentStyle.flexDirection.startsWith("row");
    const isMainAxis = (property === "width") === parentIsRow;
    if (isMainAxis) {
      return true;
    }
    // Cross axis: `auto` means stretch unless align-self opts out.
    const alignSelf = style.alignSelf;
    const resolved =
      alignSelf === "auto" || alignSelf === "normal"
        ? parentStyle.alignItems
        : alignSelf;
    return resolved !== "stretch" && resolved !== "normal";
  }

  if (property === "height") {
    return true; // Content-driven in normal flow.
  }
  return (
    style.display === "inline-flex" ||
    style.position === "absolute" ||
    style.position === "fixed" ||
    style.float !== "none"
  );
}

/**
 * The element children that participate in flex layout, or `null` when the
 * container holds something we don't model yet (absolutely positioned
 * children, text-node flex items, `order`).
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
