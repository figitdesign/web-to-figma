import { DedupCache } from "./dedup-cache";
import type {
  ImageBlobInfo,
  ImageLoader,
  ImageRenderSize,
} from "./nodes/image/loader";
import { processImageFile } from "./nodes/image/loader";

export type ImageCache = DedupCache<HTMLImageElement, ImageBlobInfo>;

export function createImageCache(imageLoader: ImageLoader): ImageCache {
  return new DedupCache({
    load: (element) =>
      imageLoader({ src: element.src, element }).then((file) =>
        processImageFile(file, bakedRenderSize(element))
      ),
    // The key has to cover the baked size as well as the source: the same URL
    // enlarged into two different boxes needs two different bitmaps.
    toCacheKey: (element) => {
      const size = bakedRenderSize(element);
      const suffix = size ? `${size.width}x${size.height}` : "natural";
      return `${element.src}|${suffix}`;
    },
  });
}

/**
 * The size the bitmap should be re-encoded at before it goes to Figma, or
 * `null` to send it untouched.
 *
 * Only enlargements are baked in. Shrinking here would throw away resolution
 * the image still needs when the frame is scaled back up in Figma, and a
 * single-pixel source resolves to a flat colour under any filter, so neither is
 * worth re-encoding.
 */
function bakedRenderSize(element: HTMLImageElement): ImageRenderSize | null {
  const naturalWidth = element.naturalWidth;
  const naturalHeight = element.naturalHeight;
  if (naturalWidth < 1 || naturalHeight < 1) {
    return null;
  }
  if (naturalWidth === 1 && naturalHeight === 1) {
    return null;
  }

  const paintSize = paintSizeForObjectFit(element, {
    width: naturalWidth,
    height: naturalHeight,
  });
  if (!paintSize) {
    return null;
  }

  const width = Math.round(paintSize.width);
  const height = Math.round(paintSize.height);
  if (width < naturalWidth || height < naturalHeight) {
    return null;
  }
  if (width === naturalWidth && height === naturalHeight) {
    return null;
  }
  return { width, height };
}

/**
 * How large the browser draws the image's own bitmap inside the element box.
 * `fill` stretches it to the box; `cover` and `contain` scale it uniformly
 * until it covers or fits. `none` and `scale-down` paint at natural size, so
 * there is nothing to bake in.
 */
function paintSizeForObjectFit(
  element: HTMLImageElement,
  natural: ImageRenderSize
): ImageRenderSize | null {
  const { width: boxWidth, height: boxHeight } =
    element.getBoundingClientRect();
  if (boxWidth < 1 || boxHeight < 1) {
    return null;
  }

  const objectFit = window.getComputedStyle(element).objectFit.trim();
  if (objectFit === "none" || objectFit === "scale-down") {
    return null;
  }
  if (objectFit !== "cover" && objectFit !== "contain") {
    return { width: boxWidth, height: boxHeight };
  }

  const scaleX = boxWidth / natural.width;
  const scaleY = boxHeight / natural.height;
  const scale =
    objectFit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return { width: natural.width * scale, height: natural.height * scale };
}
