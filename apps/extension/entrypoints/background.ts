import { defineBackground } from "#imports";

import { arrayBufferToBase64 } from "../shared/base64";
import type { FetchUrlResult } from "../shared/messaging";
import { onMessage } from "../shared/messaging";

export default defineBackground(() => {
  // Service-worker fetch proxy. Content scripts inherit the page's CORS
  // posture, so cross-origin images often fail to load when fetched from the
  // page. The service worker has `<all_urls>` host permissions and is allowed
  // to read those bytes regardless of CORS, then ferries them back as base64.
  onMessage("fetchImage", ({ data }) => fetchAsBase64(data));
  onMessage("fetchFont", ({ data }) => fetchAsBase64(data));
});

async function fetchAsBase64(url: string): Promise<FetchUrlResult> {
  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(
      `Fetch failed (${response.status} ${response.statusText}) for ${url}`
    );
  }
  const blob = await response.blob();
  return {
    bytesBase64: arrayBufferToBase64(await blob.arrayBuffer()),
    mimeType: blob.type || "application/octet-stream",
  };
}
