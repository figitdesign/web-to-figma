import { afterEach, describe, expect, it, vi } from "vitest";
import { processImageFile } from "./loader";

// The fixture PNG from __fixtures__/loaders.ts (1x1 red, 69 bytes) and its
// known SHA-1 — the same digest asserted by the browser image test.
const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const RED_PNG_SHA1_HEX = "2732f12a8f18d27cf0fa78ef41091bfa1ccec9ce";

function pngBytes(): ArrayBuffer {
  const buf = Buffer.from(RED_PNG_BASE64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const toHex = (bytes: ReadonlyArray<number>): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("processImageFile SHA-1 hashing", () => {
  it("hashes a PNG via crypto.subtle when it is available", async () => {
    const { hash, bytes } = await processImageFile({
      bytes: pngBytes(),
      mimeType: "image/png",
    });

    expect(toHex(hash)).toBe(RED_PNG_SHA1_HEX);
    expect(bytes).toHaveLength(69);
  });

  it("hashes identically when crypto.subtle is absent (non-secure context)", async () => {
    // The harness renders scenes on an about:blank page, where crypto.subtle is
    // undefined; without a fallback the image node threw and was dropped.
    vi.stubGlobal("crypto", {});

    const { hash } = await processImageFile({
      bytes: pngBytes(),
      mimeType: "image/png",
    });

    expect(toHex(hash)).toBe(RED_PNG_SHA1_HEX);
  });
});
