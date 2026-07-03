export type Position = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextEmpty(text: Text): boolean {
  return !(text.textContent || "").trim().length;
}

export function isSvgElement(element: Element): boolean {
  return element.tagName.toLowerCase() === "svg";
}

/**
 * Gets the position of an element relative to its parent.
 */
export function getElementPositionRelativeToParent(element: Element): Position {
  const parentElement = element.parentElement;
  const elementRect = element.getBoundingClientRect();

  if (!parentElement) {
    return { x: elementRect.left, y: elementRect.top };
  }

  const parentRect = parentElement.getBoundingClientRect();
  return {
    x: elementRect.left - parentRect.left,
    y: elementRect.top - parentRect.top,
  };
}

export function getElementSize(element: Element): Size {
  const elementRect = element.getBoundingClientRect();
  return {
    width: Math.ceil(elementRect.width),
    height: Math.ceil(elementRect.height),
  };
}

function getTextRect(textNode: Text) {
  const range = document.createRange();
  range.selectNodeContents(textNode);
  return range.getBoundingClientRect();
}

export function getTextPositionRelativeToParent(textNode: Text): Position {
  const parentElement = textNode.parentElement;
  if (!parentElement) {
    return { x: 0, y: 0 };
  }

  const textNodeRect = getTextRect(textNode);
  const parentElementRect = parentElement.getBoundingClientRect();

  return {
    x: textNodeRect.left - parentElementRect.left,
    y: textNodeRect.top - parentElementRect.top,
  };
}

export function getTextSize(textNode: Text, exact = false): Size {
  const textNodeRect = getTextRect(textNode);
  if (exact) {
    // Inside auto-layout stacks the box edges drive sibling positions, so
    // any inflation accumulates as visible drift — use the measured size.
    return { width: textNodeRect.width, height: textNodeRect.height };
  }
  return {
    // Fonts in Figma take 1px more width sometimes, so we add a buffer.
    width: Math.ceil(textNodeRect.width) + 1,
    height: Math.ceil(textNodeRect.height),
  };
}

export type TextLineSegment = {
  text: string;
  position: Position;
  size: Size;
};

/**
 * Split a text node into per-line segments — but only for the one shape a
 * single Figma text box cannot represent: a node that CONTINUES a line
 * started by a preceding inline sibling and then wraps (e.g. the tail text
 * in `<h1>a <span>b</span> tail that wraps</h1>`). Its first line starts at
 * an indent the box cannot encode, so the union box renders a line too high.
 *
 * Returns `null` for every other shape (single line, standalone multi-line
 * runs) so regular paragraphs keep one editable text layer.
 */
export function splitMidLineWrappedText(
  textNode: Text,
  options?: {
    /** Node whose previous sibling defines "continues a line" — the inline
     * element itself when splitting an element's inner text. */
    siblingContext?: Node;
    /** Element the segment positions are relative to. */
    relativeTo?: Element;
  }
): Array<TextLineSegment> | null {
  const relativeTo = options?.relativeTo ?? textNode.parentElement;
  const siblingContext = options?.siblingContext ?? textNode;
  const doc = textNode.ownerDocument;
  const content = textNode.textContent ?? "";
  if (!relativeTo || content.trim().length === 0) {
    return null;
  }

  const range = doc.createRange();
  range.selectNodeContents(textNode);
  const lineRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 1
  );
  if (lineRects.length < 2) {
    return null;
  }

  // Only split when the first line genuinely continues a sibling's line.
  if (!sharesLineWithPreviousSibling(siblingContext, lineRects[0] as DOMRect)) {
    return null;
  }

  // Group characters into lines by their rendered top edge.
  const parentRect = relativeTo.getBoundingClientRect();
  const segments: Array<TextLineSegment> = [];
  let start = 0;
  let lineTop: number | null = null;
  const flush = (end: number) => {
    // Measure without surrounding whitespace so boxes stay tight — the
    // emitted text is trimmed, and space widths would bleed into neighbors.
    let from = start;
    while (from < end && /\s/.test(content[from] as string)) {
      from += 1;
    }
    let to = end;
    while (to > from && /\s/.test(content[to - 1] as string)) {
      to -= 1;
    }
    if (to <= from) {
      return;
    }
    const segmentRange = doc.createRange();
    segmentRange.setStart(textNode, from);
    segmentRange.setEnd(textNode, to);
    const rect = segmentRange.getBoundingClientRect();
    segments.push({
      text: content.slice(from, to),
      position: {
        x: rect.left - parentRect.left,
        y: rect.top - parentRect.top,
      },
      size: { width: rect.width, height: rect.height },
    });
  };

  for (let i = 0; i < content.length; i += 1) {
    const charRange = doc.createRange();
    charRange.setStart(textNode, i);
    charRange.setEnd(textNode, i + 1);
    const rect = charRange.getBoundingClientRect();
    if (rect.width <= 0.5 && rect.height <= 0.5) {
      continue; // Collapsed whitespace at a wrap point.
    }
    if (lineTop === null) {
      lineTop = rect.top;
    } else if (Math.abs(rect.top - lineTop) > rect.height / 2) {
      flush(i);
      start = i;
      lineTop = rect.top;
    }
  }
  flush(content.length);

  return segments.length >= 2 ? segments : null;
}

function sharesLineWithPreviousSibling(
  contextNode: Node,
  firstLineRect: DOMRect
): boolean {
  let sibling = contextNode.previousSibling;
  while (sibling && isTextNode(sibling) && isTextEmpty(sibling)) {
    sibling = sibling.previousSibling;
  }
  if (!sibling) {
    return false;
  }

  const doc = contextNode.ownerDocument;
  if (!doc) {
    return false;
  }
  const range = doc.createRange();
  range.selectNodeContents(sibling);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1);
  const last = rects.at(-1);
  if (!last) {
    return false;
  }
  const firstCenter = firstLineRect.top + firstLineRect.height / 2;
  return last.top < firstCenter && firstCenter < last.bottom;
}

export function sortNodesByStackingOrder(nodes: Array<Node>) {
  const nonPositioned: Array<Node> = [];
  const negativeZIndex: Array<{ node: Element; zIndex: number }> = [];
  const positionedAuto: Array<Element> = [];
  const positiveZIndex: Array<{ node: Element; zIndex: number }> = [];

  for (const node of nodes) {
    if (!isElementNode(node)) {
      nonPositioned.push(node);
      continue;
    }

    const style = window.getComputedStyle(node);
    const position = style.position;
    const isPositioned =
      position === "absolute" ||
      position === "relative" ||
      position === "fixed" ||
      position === "sticky";

    if (!isPositioned) {
      nonPositioned.push(node);
      continue;
    }

    const zIndex =
      style.zIndex === "auto" ? "auto" : Number.parseInt(style.zIndex, 10) || 0;

    if (zIndex === "auto") {
      positionedAuto.push(node);
    } else if (zIndex < 0) {
      negativeZIndex.push({ node, zIndex });
    } else {
      positiveZIndex.push({ node, zIndex });
    }
  }

  negativeZIndex.sort((a, b) => a.zIndex - b.zIndex);
  positiveZIndex.sort((a, b) => a.zIndex - b.zIndex);

  return [
    ...nonPositioned,
    ...negativeZIndex.map((item) => item.node),
    ...positionedAuto,
    ...positiveZIndex.map((item) => item.node),
  ];
}
