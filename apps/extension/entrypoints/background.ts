import { defineBackground } from "#imports";

import { arrayBufferToBase64 } from "../shared/base64";
import type { FetchUrlResult } from "../shared/messaging";
import { onMessage } from "../shared/messaging";

/**
 * The bg proxy holds `<all_urls>` host permissions, so any URL it forwards to
 * `fetch` bypasses page-level CORS. A malicious page that gets the user to
 * convert it could embed a request to a private network host (router admin,
 * intranet service, etc.) via `<img src="http://192.168.x/...">` and have
 * those bytes ferried back into the Figma payload. Restrict the proxy to
 * web-public schemes so non-http(s) URLs (`file:`, `chrome:`, custom
 * protocols) can't reach the worker's privileged fetch.
 *
 * `data:` URLs are intentionally not allowed here either — they don't reach
 * the proxy in practice (the direct loader handles inline data without
 * failing) and adding them would just widen the allowed input space.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export default defineBackground(() => {
  // Service-worker fetch proxy. Content scripts inherit the page's CORS
  // posture, so cross-origin images often fail to load when fetched from the
  // page. The service worker has `<all_urls>` host permissions and is allowed
  // to read those bytes regardless of CORS, then ferries them back as base64.
  onMessage("fetchImage", ({ data }) => fetchAsBase64(data));
  onMessage("fetchFont", ({ data }) => fetchAsBase64(data));
});

async function fetchAsBase64(url: string): Promise<FetchUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `Refused to fetch ${parsed.protocol} URL via background proxy`
    );
  }

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
