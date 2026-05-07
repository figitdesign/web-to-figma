import { defineExtensionMessaging } from "@webext-core/messaging";

/**
 * Type-safe runtime messaging protocol used by the content script to ask the
 * background service worker to fetch image/font bytes outside the page's CORS
 * envelope. The background worker has `<all_urls>` host permissions and can
 * read public bytes regardless of the page's origin.
 *
 * Binary payloads are ferried as base64 because `browser.runtime.sendMessage`
 * JSON-serializes its arguments — see `shared/base64.ts`.
 */

export type FetchUrlResult = {
  bytesBase64: string;
  mimeType: string;
};

export type ProtocolMap = {
  /** Fetch an image as base64 + mime, bypassing the page's CORS posture. */
  fetchImage(src: string): FetchUrlResult;
  /** Fetch a font file as base64 + mime. */
  fetchFont(url: string): FetchUrlResult;
};

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>();
