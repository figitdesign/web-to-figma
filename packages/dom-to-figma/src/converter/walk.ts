import type { ElementKind } from "./classify";
import { defaultClassify } from "./classify";
import type { ConversionResult, InheritedProperties } from "./convert";
import { convertElement } from "./convert";
import type { TextLineSegment } from "./dom";
import {
  getElementPositionRelativeToParent,
  getTextPositionRelativeToParent,
  getTextSize,
  isElementNode,
  isSvgElement,
  isTextEmpty,
  isTextNode,
  sortNodesByStackingOrder,
  splitMidLineWrappedText,
} from "./dom";
import type { FontCache } from "./font-cache";
import type { ImageCache } from "./image-cache";
import type { InferredChildStack } from "./layout/infer";
import { nodeToTextNodeChange } from "./nodes/text";
import type { FigmaBlob, FigmaGuid, FigmaNodeChange } from "./types";

export type Classify = (
  element: Element,
  defaultKind: ElementKind
) => ElementKind;

/** `"auto"` infers Figma auto-layout for flex containers; `"absolute"` keeps
 * every frame absolutely positioned (the historical behavior). */
export type ConverterLayout = "absolute" | "auto";

export type WalkContext = {
  classify?: Classify;
  layout?: ConverterLayout;
  createGuid: () => FigmaGuid;
  registerBlob: (blob: FigmaBlob) => number;
  fontCache: FontCache;
  imageCache: ImageCache;
  appendChanges: (changes: ReadonlyArray<FigmaNodeChange>) => void;
};

const EMPTY_INHERITED: InheritedProperties = {};
const VIEWBOX_SEPARATOR = /[\s,]+/;

export async function walkRoot(
  root: Element,
  parentGuid: FigmaGuid,
  ctx: WalkContext,
  rootSize?: { width: number; height: number }
) {
  await walkNode(root, parentGuid, 0, EMPTY_INHERITED, ctx, {
    isAutoLayout: false,
    rootFill: rootSize,
  });
}

type ParentStackInfo = {
  isAutoLayout: boolean;
  childSpecs?: ReadonlyMap<Element, InferredChildStack>;
  /** Reversed flex parent: emit children in visual (reversed DOM) order. */
  reverse?: boolean;
  /** Only on the root walk: the paste-template frame size. */
  rootFill?: { width: number; height: number };
};

const NO_PARENT_STACK: ParentStackInfo = { isAutoLayout: false };

/** Returns the number of node changes emitted for this DOM node (text nodes
 * can split into several). */
async function walkNode(
  node: Node,
  parentGuid: FigmaGuid,
  childIndex: number,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext,
  parentStack: ParentStackInfo = NO_PARENT_STACK
): Promise<number> {
  try {
    if (isTextNode(node)) {
      return await renderTextNode(
        node,
        parentGuid,
        childIndex,
        inheritedProperties,
        ctx,
        parentStack.isAutoLayout
      );
    }
    if (!isElementNode(node)) {
      return 0;
    }

    const defaultKind = defaultClassify(node);
    const kind = ctx.classify ? ctx.classify(node, defaultKind) : defaultKind;

    if (kind === "skip") {
      return 0;
    }

    // An inline text element (span/a/…) whose inner text continues a line
    // and wraps needs the same per-line split as a raw text node; segments
    // are positioned against the element's parent, which is also their
    // parent in the emitted tree.
    if (kind === "text" && node.parentElement) {
      const only =
        node.childNodes.length === 1 && node.firstChild
          ? node.firstChild
          : null;
      if (only && isTextNode(only)) {
        const segments = splitMidLineWrappedText(only, {
          siblingContext: node,
          relativeTo: node.parentElement,
        });
        if (segments) {
          return await emitTextSegments(
            only,
            segments,
            parentGuid,
            childIndex,
            inheritedProperties,
            ctx
          );
        }
      }
    }

    const guid = ctx.createGuid();
    const position = getElementPositionRelativeToParent(node);

    const result = await convertElement(node, kind, {
      guid,
      parentGuid,
      childIndex,
      position,
      inheritedProperties,
      layout: ctx.layout,
      parentIsAutoLayout: parentStack.isAutoLayout,
      childStackSpec: parentStack.childSpecs?.get(node),
      rootFill: parentStack.rootFill,
      registerBlob: ctx.registerBlob,
      fontCache: ctx.fontCache,
      imageCache: ctx.imageCache,
      createGuid: ctx.createGuid,
    });

    ctx.appendChanges(result.changes);

    if (result.hasChildren) {
      await walkChildren(
        node,
        guid,
        nextInheritedProperties(node, inheritedProperties, result),
        ctx,
        {
          isAutoLayout: result.isAutoLayout ?? false,
          childSpecs: result.childStackSpecs,
          reverse: result.reverseChildren,
        }
      );
    }

    return 1;
  } catch (error) {
    console.warn("Failed to process node:", error);
    return 0;
  }
}

async function walkChildren(
  element: Element,
  parentGuid: FigmaGuid,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext,
  parentStack: ParentStackInfo = NO_PARENT_STACK
) {
  const sortedNodes = sortNodesByStackingOrder(Array.from(element.childNodes));
  if (parentStack.reverse) {
    // Reversed flex parent: Figma stacks lay children out in emission order,
    // so emit the visual order; stackReverseZIndex restores paint order.
    sortedNodes.reverse();
  }

  let childNodeIndex = 0;
  for (const node of sortedNodes) {
    childNodeIndex += await walkNode(
      node,
      parentGuid,
      childNodeIndex,
      inheritedProperties,
      ctx,
      parentStack
    );
  }
}

async function renderTextNode(
  textNode: Text,
  parentGuid: FigmaGuid,
  childIndex: number,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext,
  parentIsAutoLayout = false
): Promise<number> {
  if (isTextEmpty(textNode)) {
    return 0;
  }
  if (!textNode.parentElement) {
    return 0;
  }

  // A text node that continues a sibling's line and wraps cannot be one
  // Figma text box (its indented first line isn't representable): emit one
  // box per rendered line instead.
  const segments = splitMidLineWrappedText(textNode);
  if (segments) {
    return await emitTextSegments(
      textNode,
      segments,
      parentGuid,
      childIndex,
      inheritedProperties,
      ctx
    );
  }

  const guid = ctx.createGuid();
  const change = await nodeToTextNodeChange(textNode, {
    guid,
    parentGuid,
    childIndex,
    position: getTextPositionRelativeToParent(textNode),
    // Exact size inside stacks: box edges drive sibling positions there.
    size: getTextSize(textNode, parentIsAutoLayout),
    textContent: (textNode.textContent || "").trim(),
    registerBlob: ctx.registerBlob,
    inheritedProperties,
    fontCache: ctx.fontCache,
  });

  ctx.appendChanges([change]);
  return 1;
}

async function emitTextSegments(
  textNode: Text,
  segments: ReadonlyArray<TextLineSegment>,
  parentGuid: FigmaGuid,
  childIndex: number,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext
): Promise<number> {
  let emitted = 0;
  for (const segment of segments) {
    const change = await nodeToTextNodeChange(textNode, {
      guid: ctx.createGuid(),
      parentGuid,
      childIndex: childIndex + emitted,
      position: segment.position,
      size: segment.size,
      textContent: segment.text,
      registerBlob: ctx.registerBlob,
      inheritedProperties,
      fontCache: ctx.fontCache,
    });
    ctx.appendChanges([change]);
    emitted += 1;
  }
  return emitted;
}

function nextInheritedProperties(
  element: Element,
  prev: InheritedProperties,
  result: ConversionResult
): InheritedProperties {
  let svgViewbox = prev.svgViewbox;
  if (isSvgElement(element)) {
    const parsed = element
      .getAttribute("viewBox")
      ?.split(VIEWBOX_SEPARATOR)
      .map(Number);
    if (parsed) {
      svgViewbox = {
        width: parsed[2] ?? 0,
        height: parsed[3] ?? 0,
      };
    }
  }

  return {
    textGradient: result.frameTextGradient ?? prev.textGradient,
    svgViewbox,
  };
}
