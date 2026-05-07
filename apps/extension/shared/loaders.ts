import type { FontLoader, ImageLoader } from "@sleekdesign/dom-to-figma";
import { createFontsourceLoader } from "@sleekdesign/dom-to-figma";

import { base64ToArrayBuffer } from "./base64";
import { sendMessage } from "./messaging";

/**
 * Image loader that tries a direct content-script `fetch(src)` first and falls
 * back to a background-service-worker proxy on failure. The proxy uses the
 * extension's `<all_urls>` host permissions to bypass page CORS.
 */
export function createBackgroundImageLoader(): ImageLoader {
  return async ({ src }) => {
    try {
      const response = await fetch(src);
      if (response.ok) {
        const blob = await response.blob();
        return {
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type || "application/octet-stream",
        };
      }
    } catch {
      // CORS or network — fall through to background proxy.
    }
    const result = await sendMessage("fetchImage", src);
    return {
      bytes: base64ToArrayBuffer(result.bytesBase64),
      mimeType: result.mimeType,
    };
  };
}

/**
 * Font loader. fontsource (jsdelivr) sends permissive CORS headers, so the
 * default direct-fetch loader works fine from a content script. Exposed here
 * for symmetry with the image loader and so callers can swap it out later.
 */
export function createSleekFontLoader(): FontLoader {
  return createFontsourceLoader();
}
