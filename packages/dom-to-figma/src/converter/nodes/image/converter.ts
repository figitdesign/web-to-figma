import type { Position } from "../../dom";
import type { ImageCache } from "../../image-cache";
import { parseBorderFromComputedStyle } from "../../styles/border";
import { parseOpacity } from "../../styles/opacity";
import { cssBoxShadowToFigmaEffects } from "../../styles/shadow";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaNodeChange,
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

  const { hash, bytes } = await imageCache.get(element);
  const blobIndex = registerBlob({ bytes });

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

    /* Fill */
    fillPaints: [
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
          hash,
          dataBlob: blobIndex,
        },
        // imageThumbnail: {
        //   hash: [],
        //   name: "image",
        // },
        imageScaleMode: objectFitToScaleMode(computedStyle.objectFit),
        // animationFrame: 0,
        // imageShouldColorManage: true,
        // rotation: 0.0,
        // scale: 0.5,
        // originalImageWidth: 3000,
        // originalImageHeight: 2003,
        // thumbHash: [],
        // altText: "",
      },
    ],

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
