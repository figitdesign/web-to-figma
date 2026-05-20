import type { FigmaColor, FigmaTransform } from "./core";

type FigmaImageScaleMode = "FILL" | "FIT" | "STRETCH" | "TILE";

type FigmaBasePaint = {
  opacity: number;
  visible: boolean;
  blendMode: string;
  transform?: FigmaTransform;
};

type FigmaSolidPaint = FigmaBasePaint & {
  type: "SOLID";
  color: FigmaColor;
};

type FigmaGradientLinearPaint = FigmaBasePaint & {
  type: "GRADIENT_LINEAR";
  stops: Array<{
    color: FigmaColor;
    position: number;
  }>;
};

type FigmaImagePaint = FigmaBasePaint & {
  type: "IMAGE";
  image: {
    hash: Array<number>;
    dataBlob?: number;
    name?: string;
  };
  imageThumbnail?: {
    hash: Array<number>;
    name?: string;
  };
  imageScaleMode?: FigmaImageScaleMode;
  animationFrame?: number;
  imageShouldColorManage?: boolean;
  rotation?: number;
  scale?: number;
  originalImageWidth?: number;
  originalImageHeight?: number;
  thumbHash?: Array<number>;
  altText?: string;
};

export type FigmaPaint =
  | FigmaSolidPaint
  | FigmaImagePaint
  | FigmaGradientLinearPaint;
