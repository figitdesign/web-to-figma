import type { ElementKind } from "./classify";
import type { Position } from "./dom";
import type { FontCache } from "./font-cache";
import type { ImageCache } from "./image-cache";
import type { InferredChildStack } from "./layout/infer";
import { elementToFormNodeChange } from "./nodes/form";
import { elementToFrameNodeChange } from "./nodes/frame";
import { elementToGroupNodeChange } from "./nodes/group";
import { elementToImageNodeChange } from "./nodes/image";
import { nodeToTextNodeChange } from "./nodes/text";
import type { SVGChildElement } from "./nodes/vector/converter";
import { elementToVectorNodeChange } from "./nodes/vector/converter";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
} from "./types";
import type { ConverterLayout } from "./walk";

export type InheritedProperties = {
  textGradient?: Array<FigmaPaint>;
  svgViewbox?: { width: number; height: number };
};

export type ConvertContext = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  inheritedProperties: InheritedProperties;
  layout?: ConverterLayout;
  /** True when the direct parent frame became an inferred auto-layout stack. */
  parentIsAutoLayout?: boolean;
  /** This node's fill/stretch overrides from the parent stack's inference. */
  childStackSpec?: InferredChildStack;
  registerBlob: (blob: FigmaBlob) => number;
  fontCache: FontCache;
  imageCache: ImageCache;
  createGuid: () => FigmaGuid;
};

export type ConversionResult = {
  changes: ReadonlyArray<FigmaNodeChange>;
  hasChildren: boolean;
  /** Text gradient produced by a frame's `background-clip: text`, propagated to descendants. */
  frameTextGradient?: Array<FigmaPaint>;
  /** True when this element became an inferred auto-layout stack. */
  isAutoLayout?: boolean;
  /** Fill/stretch overrides for this element's children, keyed by element. */
  childStackSpecs?: ReadonlyMap<Element, InferredChildStack>;
};

export async function convertElement(
  element: Element,
  kind: ElementKind,
  ctx: ConvertContext
): Promise<ConversionResult> {
  const {
    guid,
    parentGuid,
    childIndex,
    position,
    inheritedProperties,
    layout,
    parentIsAutoLayout,
    childStackSpec,
    registerBlob,
    fontCache,
    imageCache,
    createGuid,
  } = ctx;

  switch (kind) {
    case "skip":
      return { changes: [], hasChildren: false };

    case "group":
      return {
        changes: [
          elementToGroupNodeChange(element, {
            guid,
            parentGuid,
            childIndex,
            position,
          }),
        ],
        hasChildren: true,
      };

    case "frame": {
      const frameResult = elementToFrameNodeChange(element, {
        guid,
        parentGuid,
        childIndex,
        position,
        layout,
        parentIsAutoLayout,
        childStackSpec,
      });
      return {
        changes: [frameResult.nodeChange],
        hasChildren: true,
        frameTextGradient: frameResult.textGradient,
        isAutoLayout: frameResult.isAutoLayout,
        childStackSpecs: frameResult.childStackSpecs,
      };
    }

    case "vector":
      return {
        changes: [
          elementToVectorNodeChange(element as SVGChildElement, {
            guid,
            parentGuid,
            childIndex,
            position,
            registerBlob,
          }),
        ],
        hasChildren: false,
      };

    case "image":
      return {
        changes: [
          await elementToImageNodeChange(element as HTMLImageElement, {
            guid,
            parentGuid,
            childIndex,
            position,
            registerBlob,
            imageCache,
          }),
        ],
        hasChildren: false,
      };

    case "text":
      return {
        changes: [
          await nodeToTextNodeChange(element, {
            guid,
            parentGuid,
            childIndex,
            position,
            registerBlob,
            inheritedProperties,
            fontCache,
          }),
        ],
        hasChildren: false,
      };

    case "form-with-placeholder":
      return {
        changes: await elementToFormNodeChange({
          element,
          guid,
          parentGuid,
          childIndex,
          position,
          registerBlob,
          inheritedProperties,
          fontCache,
          createGuid,
        }),
        hasChildren: false,
      };

    default:
      throw new Error(`Unknown ElementKind: ${kind satisfies never}`);
  }
}
