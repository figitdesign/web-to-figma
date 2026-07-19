import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const RGBA = 4;
const DEFAULT_THRESHOLD = 0.1;

export type PngData = { width: number; height: number; data: Uint8Array };

export function decodePng(buffer: Uint8Array): PngData {
  const png = PNG.sync.read(Buffer.from(buffer));
  return { width: png.width, height: png.height, data: png.data };
}

function encodePng(image: PngData): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

/** Box-average downsample by an integer factor (Figma Copy-as-PNG is 2×).
 * Averaging also damps the anti-aliasing noise that dominates Chrome-vs-Figma
 * pixel differences. */
export function downsample(src: PngData, factor: number): PngData {
  const width = Math.floor(src.width / factor);
  const height = Math.floor(src.height / factor);
  const data = new Uint8Array(width * height * RGBA);
  const samples = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < RGBA; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const si =
              ((y * factor + dy) * src.width + (x * factor + dx)) * RGBA + c;
            sum += src.data[si] ?? 0;
          }
        }
        data[(y * width + x) * RGBA + c] = Math.round(sum / samples);
      }
    }
  }
  return { width, height, data };
}

export type PixelDiff = {
  diffRatio: number;
  /** 1 per differing pixel, row-major, length width*height. */
  mask: Uint8Array;
  width: number;
  height: number;
  diffPng: Buffer;
};

/** Compare two same-sized RGBA images. Returns the diff ratio, a per-pixel
 * mask, and a diff-mask PNG artifact. */
export function diffImages(
  a: PngData,
  b: PngData,
  threshold: number = DEFAULT_THRESHOLD
): PixelDiff {
  const { width, height } = a;
  const output = new Uint8Array(width * height * RGBA);
  const numDiff = pixelmatch(a.data, b.data, output, width, height, {
    threshold,
    includeAA: false,
    diffMask: true,
  });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = (output[i * RGBA + 3] ?? 0) > 0 ? 1 : 0;
  }
  return {
    diffRatio: numDiff / (width * height),
    mask,
    width,
    height,
    diffPng: encodePng({ width, height, data: output }),
  };
}
