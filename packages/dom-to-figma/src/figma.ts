import {
  composeClipboardHtml,
  encodeFigmaData,
  toClipboardItem,
} from "@figit/fig-kiwi";
import { BlobManager } from "./converter/blob-manager";
import { createFontCache } from "./converter/font-cache";
import { createImageCache } from "./converter/image-cache";
import type { ImageLoader } from "./converter/nodes/image/loader";
import { createDirectImageLoader } from "./converter/nodes/image/loader";
import {
  getMultiFrameRootTemplate,
  getRootTemplate,
  ROOT_FRAME_GUID,
} from "./converter/nodes/root";
import type { FontLoader } from "./converter/nodes/text/primitives/font/loader";
import { createFontsourceLoader } from "./converter/nodes/text/primitives/font/loader";
import type {
  FigmaClipboard,
  FigmaGuid,
  FigmaNodeChange,
} from "./converter/types";
import type { Classify, ConverterLayout, WalkContext } from "./converter/walk";
import { walkRoot } from "./converter/walk";

export type { ElementKind } from "./converter/classify";
export { defaultClassify } from "./converter/classify";
export type {
  ImageFile,
  ImageLoader,
  ImageRequest,
} from "./converter/nodes/image/loader";
export { createDirectImageLoader } from "./converter/nodes/image/loader";
export type {
  FontFile,
  FontLoader,
  FontProperties,
  FontsourceLoaderOptions,
} from "./converter/nodes/text/primitives/font/loader";
export { createFontsourceLoader } from "./converter/nodes/text/primitives/font/loader";
export type { FigmaClipboard } from "./converter/types";
export type { Classify, ConverterLayout } from "./converter/walk";

export type FrameInput = {
  element: Element;
  width: number;
  height: number;
  x: number;
  y: number;
  name: string;
};

export type FigmaConverterConfig = {
  /** Defaults to `createFontsourceLoader()` (Google Fonts via fontsource jsDelivr CDN). */
  fontLoader?: FontLoader;
  /** Defaults to `createDirectImageLoader()` (single direct `fetch(src)`). */
  imageLoader?: ImageLoader;
  /** Override the default DOM-element classification. */
  classify?: Classify;
  /**
   * `"auto"` (default) converts containers into Figma auto-layout frames
   * whenever the layout can be reproduced exactly, falling back to absolute
   * positioning per node when it can't. `"absolute"` positions every frame
   * absolutely, disabling auto-layout inference entirely.
   */
  layout?: ConverterLayout;
};

export type SingleFrameInput = {
  element: Element;
  width: number;
  height: number;
  name?: string;
};

export type CanvasInput = {
  frames: ReadonlyArray<FrameInput>;
  canvasName?: string;
};

export type ConvertInput = SingleFrameInput | CanvasInput;

export type ConvertResult = {
  /** Raw Figma node-change document. */
  document: FigmaClipboard;
  /** Encoded `.fig`-style binary. */
  bytes: Uint8Array;
  /** Base64-encoded representation of `bytes`. */
  base64: string;
  /** Construct a browser `ClipboardItem` for `navigator.clipboard.write([...])`. */
  toClipboardItem(): ClipboardItem;
  /** Get the raw HTML envelope Figma reads on paste. */
  toClipboardHtml(): string;
};

export type FigmaConverter = {
  convert(input: ConvertInput): Promise<ConvertResult>;
  /** Drop cached fonts and images. Useful in long-running processes. */
  clearCache(): void;
};

const ROOT_RESERVED_GUIDS = 3;

export function createFigmaConverter(
  config: FigmaConverterConfig = {}
): FigmaConverter {
  const fontLoader = config.fontLoader ?? createFontsourceLoader();
  const imageLoader = config.imageLoader ?? createDirectImageLoader();
  const { classify } = config;
  const layout = config.layout ?? "auto";

  const fontCache = createFontCache(fontLoader);
  const imageCache = createImageCache(imageLoader);

  const convert = async (input: ConvertInput): Promise<ConvertResult> => {
    const nodeChanges: Array<FigmaNodeChange> = [];
    const blobManager = new BlobManager();
    let idCounter = ROOT_RESERVED_GUIDS;

    const createGuid = (): FigmaGuid => {
      const localID = idCounter;
      idCounter += 1;
      return { sessionID: 0, localID };
    };

    const walkContext: WalkContext = {
      classify,
      layout,
      createGuid,
      registerBlob: (blob) => blobManager.registerBlob(blob),
      fontCache,
      imageCache,
      appendChanges: (changes) => {
        for (const change of changes) {
          nodeChanges.push(change);
        }
      },
    };

    const document =
      "frames" in input
        ? await buildCanvas(input, walkContext, blobManager, createGuid)
        : await buildSingle(input, walkContext, blobManager);

    document.nodeChanges.push(...nodeChanges);

    const encoded = encodeFigmaData(document);

    return {
      document,
      bytes: encoded.figBytes,
      base64: encoded.base64,
      toClipboardItem: () =>
        toClipboardItem(composeClipboardHtml(encoded.base64)),
      toClipboardHtml: () => composeClipboardHtml(encoded.base64),
    };
  };

  return {
    convert,
    clearCache() {
      fontCache.clear();
      imageCache.clear();
    },
  };
}

async function buildSingle(
  input: SingleFrameInput,
  walkContext: WalkContext,
  blobManager: BlobManager
): Promise<FigmaClipboard> {
  await walkRoot(input.element, ROOT_FRAME_GUID, walkContext, {
    width: input.width,
    height: input.height,
  });
  return getRootTemplate({
    width: input.width,
    height: input.height,
    blobs: blobManager.getBlobs(),
    name: input.name,
  });
}

async function buildCanvas(
  input: CanvasInput,
  walkContext: WalkContext,
  blobManager: BlobManager,
  createGuid: () => FigmaGuid
): Promise<FigmaClipboard> {
  const frameConfigs: Array<{
    width: number;
    height: number;
    x: number;
    y: number;
    name: string;
    localId: number;
  }> = [];

  for (const frame of input.frames) {
    const frameGuid = createGuid();
    frameConfigs.push({
      width: frame.width,
      height: frame.height,
      x: frame.x,
      y: frame.y,
      name: frame.name,
      localId: frameGuid.localID,
    });
    await walkRoot(frame.element, frameGuid, walkContext, {
      width: frame.width,
      height: frame.height,
    });
  }

  return getMultiFrameRootTemplate({
    frames: frameConfigs,
    blobs: blobManager.getBlobs(),
    canvasName: input.canvasName,
  });
}
