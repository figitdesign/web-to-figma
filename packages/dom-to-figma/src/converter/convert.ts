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
import { clipFrameNodeChange, resolveSvgClip } from "./nodes/vector/clip-path";
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
  /** Set for the converted root element only: the paste-template frame size. */
  rootFill?: { width: number; height: number };
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
  /** Reversed flex direction: children must be emitted in visual order. */
  reverseChildren?: boolean;
  /** Child slots (e.g. decomposed border sides) already emitted under this
   * node's guid; the walker starts its real children after them so their
   * `parentIndex.position` does not collide and they paint on top. */
  reservedChildCount?: number;
};

/**
 * Stamp the parent stack's child overrides (e.g. `stackPositioning:
 * "ABSOLUTE"`) onto a converted element's own node change. The frame
 * converter merges these itself; every other kind gets them here.
 */
function withChildStackSpec(
  changes: ReadonlyArray<FigmaNodeChange>,
  childStackSpec: InferredChildStack | undefined
): ReadonlyArray<FigmaNodeChange> {
  if (!childStackSpec || changes.length === 0) {
    return changes;
  }
  const [own, ...rest] = changes;
  return [{ ...own, ...childStackSpec } as FigmaNodeChange, ...rest];
}

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
    rootFill,
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
        rootFill,
        createGuid,
        registerBlob,
      });
      const borderChildren = frameResult.borderChildren ?? [];
      return {
        changes: [
          frameResult.nodeChange,
          ...borderChildren,
          ...(frameResult.extraChildren ?? []),
        ],
        hasChildren: true,
        reservedChildCount: borderChildren.length,
        frameTextGradient: frameResult.textGradient,
        isAutoLayout: frameResult.isAutoLayout,
        childStackSpecs: frameResult.childStackSpecs,
        reverseChildren: frameResult.reverseChildren,
      };
    }

    case "vector": {
      const clip = resolveSvgClip(element);
      if (!clip) {
        return {
          changes: withChildStackSpec(
            [
              elementToVectorNodeChange(element as SVGChildElement, {
                guid,
                parentGuid,
                childIndex,
                position,
                registerBlob,
              }),
            ],
            childStackSpec
          ),
          hasChildren: false,
        };
      }

      // The shape keeps `guid` (and so its own geometry, which the trace and
      // the ground truth are matched on); the clipping frame wrapping it gets
      // a fresh one. `position` is relative to the element's parent, so the
      // clip offset moves the frame and un-moves the shape inside it.
      const frameGuid = createGuid();
      const rect = element.getBoundingClientRect();
      const offsetX = clip.rect.x - rect.left;
      const offsetY = clip.rect.y - rect.top;

      const maskChanges = clip.isRectangular
        ? []
        : [
            {
              ...elementToVectorNodeChange(clip.shape, {
                guid: createGuid(),
                parentGuid: frameGuid,
                childIndex: 0,
                position: { x: 0, y: 0 },
                size: { width: clip.rect.width, height: clip.rect.height },
                registerBlob,
              }),
              name: "Clip",
              mask: true,
              maskType: "OUTLINE",
            },
          ];

      return {
        changes: withChildStackSpec(
          [
            clipFrameNodeChange({
              guid: frameGuid,
              parentGuid,
              childIndex,
              position: {
                x: position.x + offsetX,
                y: position.y + offsetY,
              },
              size: { width: clip.rect.width, height: clip.rect.height },
            }),
            ...maskChanges,
            elementToVectorNodeChange(element as SVGChildElement, {
              guid,
              parentGuid: frameGuid,
              childIndex: maskChanges.length,
              position: {
                x: rect.left - clip.rect.x,
                y: rect.top - clip.rect.y,
              },
              registerBlob,
            }),
          ],
          childStackSpec
        ),
        hasChildren: false,
      };
    }

    case "image":
      return {
        changes: withChildStackSpec(
          [
            await elementToImageNodeChange(element as HTMLImageElement, {
              guid,
              parentGuid,
              childIndex,
              position,
              registerBlob,
              imageCache,
            }),
          ],
          childStackSpec
        ),
        hasChildren: false,
      };

    case "text": {
      // Inside stacks the box edges drive sibling positions, so use the
      // exact measured size instead of the converter's ceiled default.
      const exactSize = parentIsAutoLayout
        ? (() => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })()
        : undefined;
      return {
        changes: withChildStackSpec(
          [
            await nodeToTextNodeChange(element, {
              guid,
              parentGuid,
              childIndex,
              position,
              size: exactSize,
              registerBlob,
              inheritedProperties,
              fontCache,
            }),
          ],
          childStackSpec
        ),
        hasChildren: false,
      };
    }

    case "form-with-placeholder":
      return {
        changes: withChildStackSpec(
          await elementToFormNodeChange({
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
          childStackSpec
        ),
        hasChildren: false,
      };

    default:
      throw new Error(`Unknown ElementKind: ${kind satisfies never}`);
  }
}
