import type { Position } from "../../dom";
import type { ImageCache } from "../../image-cache";
import { parseBorderFromComputedStyle } from "../../styles/border";
import { cssColorToFigmaColor } from "../../styles/color";
import { parseOpacity } from "../../styles/opacity";
import { cssBoxShadowToFigmaEffects } from "../../styles/shadow";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
  FigmaRoundedRectangleNodeChange,
} from "../../types";

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  registerBlob: (blob: FigmaBlob) => number;
  imageCache: ImageCache;
};

/**
 * Maps CSS `object-fit` onto Figma's image scale modes. CSS defaults to `fill`
 * (stretch to the box, ignoring aspect ratio), which is Figma's `STRETCH` — not
 * `FILL`, which is Figma's name for the cover behaviour.
 *
 * `none` and `scale-down` have no Figma equivalent; `FIT` is the closest, since
 * it at least preserves the image's aspect ratio.
 */
function objectFitToScaleMode(objectFit: string): "FILL" | "FIT" | "STRETCH" {
  switch (objectFit.trim()) {
    case "cover":
      return "FILL";
    case "contain":
    case "none":
    case "scale-down":
      return "FIT";
    default:
      return "STRETCH";
  }
}

/**
 * Browsers paint a thin grey outline inside the box of an `<img>` whose source
 * failed to load, so the slot stays visible instead of collapsing to nothing.
 * Reproduce it when the element has no border of its own, so a paste keeps the
 * placeholder the page was showing.
 */
const BROKEN_IMAGE_OUTLINE_WEIGHT = 1;
const BROKEN_IMAGE_OUTLINE_COLOR = "rgb(192, 192, 192)";

function brokenImageOutlinePaints(): Array<FigmaPaint> {
  const parsed = cssColorToFigmaColor(BROKEN_IMAGE_OUTLINE_COLOR);
  if (!parsed) {
    return [];
  }
  return [
    {
      type: "SOLID",
      color: parsed.color,
      opacity: parsed.opacity,
      visible: true,
      blendMode: "NORMAL",
    },
  ];
}

export async function elementToImageNodeChange(
  element: HTMLImageElement,
  options: Params
): Promise<FigmaRoundedRectangleNodeChange> {
  const { guid, parentGuid, childIndex, position, registerBlob, imageCache } =
    options;

  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  const boxShadow = computedStyle.boxShadow;
  const effects = cssBoxShadowToFigmaEffects(boxShadow);
  const opacity = parseOpacity(computedStyle.opacity);

  // Parse border information (includes border radius)
  const borderProperties = parseBorderFromComputedStyle(computedStyle, {
    width,
    height,
  });

  // A source that won't load still occupies its box on the page, so keep the
  // node and fall back to a placeholder rather than dropping it from the tree.
  const blob = await imageCache.get(element).catch((error: unknown) => {
    console.warn("Failed to load image:", element.src, error);
    return null;
  });
  const fillPaints: Array<FigmaPaint> = blob
    ? [
        {
          type: "IMAGE",
          opacity: 1.0,
          visible: true,
          blendMode: "NORMAL",
          transform: {
            m00: 1.0,
            m01: 0.0,
            m02: 0.0,
            m10: 0.0,
            m11: 1.0,
            m12: 0.0,
          },
          image: {
            hash: blob.hash,
            dataBlob: registerBlob({ bytes: blob.bytes }),
          },
          imageScaleMode: objectFitToScaleMode(computedStyle.objectFit),
        },
      ]
    : [];

  const brokenPlaceholder = !blob && borderProperties.strokePaints.length === 0;

  const nodeChange: FigmaNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "ROUNDED_RECTANGLE",
    name: "Image",
    visible: true,
    opacity,

    /* Size and Position */
    size: {
      x: width,
      y: height,
    },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
    },

    /* Stroke and Corner Radius */
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    ...borderProperties,
    ...(brokenPlaceholder && {
      strokeWeight: BROKEN_IMAGE_OUTLINE_WEIGHT,
      strokePaints: brokenImageOutlinePaints(),
    }),

    /* Fill */
    fillPaints,

    /* Effects */
    effects,

    /* Aspect Ratio */
    targetAspectRatio: {
      value: {
        x: width,
        y: height,
      },
    },
  };

  return nodeChange;
}
