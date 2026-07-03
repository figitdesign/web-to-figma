import type { ElementKind } from "./classify";
import { defaultClassify } from "./classify";
import type { ConversionResult, InheritedProperties } from "./convert";
import { convertElement } from "./convert";
import {
  getElementPositionRelativeToParent,
  getTextPositionRelativeToParent,
  getTextSize,
  isElementNode,
  isSvgElement,
  isTextEmpty,
  isTextNode,
  sortNodesByStackingOrder,
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

async function walkNode(
  node: Node,
  parentGuid: FigmaGuid,
  childIndex: number,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext,
  parentStack: ParentStackInfo = NO_PARENT_STACK
): Promise<boolean> {
  try {
    if (isTextNode(node)) {
      return await renderTextNode(
        node,
        parentGuid,
        childIndex,
        inheritedProperties,
        ctx
      );
    }
    if (!isElementNode(node)) {
      return false;
    }

    const defaultKind = defaultClassify(node);
    const kind = ctx.classify ? ctx.classify(node, defaultKind) : defaultKind;

    if (kind === "skip") {
      return false;
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

    return true;
  } catch (error) {
    console.warn("Failed to process node:", error);
    return false;
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
    const success = await walkNode(
      node,
      parentGuid,
      childNodeIndex,
      inheritedProperties,
      ctx,
      parentStack
    );
    if (success) {
      childNodeIndex += 1;
    }
  }
}

async function renderTextNode(
  textNode: Text,
  parentGuid: FigmaGuid,
  childIndex: number,
  inheritedProperties: InheritedProperties,
  ctx: WalkContext
): Promise<boolean> {
  if (isTextEmpty(textNode)) {
    return false;
  }
  if (!textNode.parentElement) {
    return false;
  }

  const guid = ctx.createGuid();
  const change = await nodeToTextNodeChange(textNode, {
    guid,
    parentGuid,
    childIndex,
    position: getTextPositionRelativeToParent(textNode),
    size: getTextSize(textNode),
    textContent: (textNode.textContent || "").trim(),
    registerBlob: ctx.registerBlob,
    inheritedProperties,
    fontCache: ctx.fontCache,
  });

  ctx.appendChanges([change]);
  return true;
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
