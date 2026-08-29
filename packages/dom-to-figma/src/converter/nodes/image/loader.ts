/**
 * Identifier for the image being loaded. The element is included so loaders
 * can read auxiliary attributes (`crossOrigin`, `referrerPolicy`, etc.) when
 * choosing a fetch strategy, but `src` is the canonical key.
 */
export type ImageRequest = {
  src: string;
  element: HTMLImageElement;
};

/**
 * Bytes returned from the loader along with the actual content type. The
 * package re-encodes to PNG when the type isn't directly supported by Figma's
 * clipboard format.
 */
export type ImageFile = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export type ImageLoader = (request: ImageRequest) => Promise<ImageFile>;

/** Size in CSS pixels at which the browser paints an image's own bitmap. */
export type ImageRenderSize = {
  width: number;
  height: number;
};

/**
 * Result of processing an `ImageFile` for Figma blob registration.
 */
export type ImageBlobInfo = {
  /** SHA-1 of the (possibly re-encoded) bytes — Figma's blob identifier. */
  hash: Array<number>;
  /** Bytes ready for Figma blob registration (PNG/JPEG/GIF). */
  bytes: Array<number>;
};

const FIGMA_SUPPORTED_FORMATS = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
] as const;

const PNG_QUALITY = 1.0;

/**
 * Ceiling on a baked-in enlargement, so a small spacer image stretched across a
 * whole page can't turn into a hundred-megabyte blob.
 */
const MAX_BAKED_PIXELS = 4_000_000;

/**
 * Build an `ImageLoader` that performs a single direct `fetch(src)`. Works
 * for same-origin images and remote images that send permissive CORS headers.
 * Cross-origin images without CORS will throw — consumers that need a proxy
 * chain should inject their own `ImageLoader`.
 */
export function createDirectImageLoader(): ImageLoader {
  return async ({ src }) => {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Image fetch failed (${response.status}): ${src}`);
    }
    const blob = await response.blob();
    return {
      bytes: await blob.arrayBuffer(),
      mimeType: blob.type,
    };
  };
}

/**
 * Convert raw loader output into Figma-ready blob info: bake in an enlargement
 * when `renderSize` asks for one, otherwise re-encode to PNG when the mime type
 * isn't supported, then SHA-1 hash the final bytes.
 */
export async function processImageFile(
  file: ImageFile,
  renderSize?: ImageRenderSize | null
): Promise<ImageBlobInfo> {
  const baked = renderSize ? await bakeRenderSize(file, renderSize) : null;
  const finalBytes =
    baked ??
    (isFigmaSupportedFormat(file.mimeType)
      ? file.bytes
      : await convertToPng(file));

  const hash = await sha1(finalBytes);
  return {
    hash,
    bytes: Array.from(new Uint8Array(finalBytes)),
  };
}

/**
 * Redraw the bitmap at the size the page paints it. Figma stores the source
 * bitmap and rescales it with its own filter, so an image the page enlarges
 * otherwise lands with different interpolation than the browser showed; a
 * canvas `drawImage` reproduces CSS scaling exactly, and Figma then paints the
 * result 1:1.
 *
 * Returns `null` — leaving the original bytes to take the usual path — when the
 * request is too large to be worth re-encoding or the source won't decode.
 */
async function bakeRenderSize(
  file: ImageFile,
  renderSize: ImageRenderSize
): Promise<ArrayBuffer | null> {
  const { width, height } = renderSize;
  if (width * height > MAX_BAKED_PIXELS) {
    return null;
  }

  const sourceBlob = new Blob([file.bytes], { type: file.mimeType });
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await loadImageElement(objectUrl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    const pngBlob = await canvasToBlob(canvas, "image/png", PNG_QUALITY);
    return await pngBlob.arrayBuffer();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function isFigmaSupportedFormat(mimeType: string): boolean {
  return FIGMA_SUPPORTED_FORMATS.includes(
    mimeType.toLowerCase() as (typeof FIGMA_SUPPORTED_FORMATS)[number]
  );
}

async function convertToPng(file: ImageFile): Promise<ArrayBuffer> {
  const sourceBlob = new Blob([file.bytes], { type: file.mimeType });
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await loadImageElement(objectUrl);
    const canvas = createCanvasFromImage(img);
    if (!canvas) {
      throw new Error("Failed to create canvas for PNG conversion");
    }
    const pngBlob = await canvasToBlob(canvas, "image/png", PNG_QUALITY);
    return await pngBlob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function createCanvasFromImage(
  img: HTMLImageElement
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob"));
        }
      },
      type,
      quality
    );
  });
}

/**
 * SHA-1 the bytes for Figma's blob identifier. Prefers `crypto.subtle` when
 * present, but that API is gated to secure contexts — it is absent on plain
 * `about:blank`/`http:` pages — so fall back to a pure-JS digest to keep image
 * conversion working everywhere the converter runs.
 */
async function sha1(buffer: ArrayBuffer): Promise<Array<number>> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashBuffer = await subtle.digest("SHA-1", buffer);
    return Array.from(new Uint8Array(hashBuffer));
  }
  return sha1Fallback(buffer);
}

function sha1Fallback(buffer: ArrayBuffer): Array<number> {
  const bytes = new Uint8Array(buffer);
  const bitLen = bytes.length * 8;
  // Pad to a multiple of 64 bytes: 0x80, zeros, then the 64-bit big-endian length.
  const totalLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const block = new Uint8Array(totalLen);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 2 ** 32), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x67_45_23_01;
  let h1 = 0xef_cd_ab_89;
  let h2 = 0x98_ba_dc_fe;
  let h3 = 0x10_32_54_76;
  let h4 = 0xc3_d2_e1_f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      w[t] = view.getUint32(offset + t * 4, false);
    }
    for (let t = 16; t < 80; t += 1) {
      const x =
        (w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0);
      w[t] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a_82_79_99;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6e_d9_eb_a1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f_1b_bc_dc;
      } else {
        f = b ^ c ^ d;
        k = 0xca_62_c1_d6;
      }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + (w[t] ?? 0)) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = tmp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0 >>> 0, false);
  outView.setUint32(4, h1 >>> 0, false);
  outView.setUint32(8, h2 >>> 0, false);
  outView.setUint32(12, h3 >>> 0, false);
  outView.setUint32(16, h4 >>> 0, false);
  return Array.from(out);
}
