/**
 * Cross-entrypoint coordination details for the popup → content trigger flow
 * and the shadow-root UI's host-tag identity. Both ends of these wires need
 * to agree on the strings, so this module is the one source of truth.
 */

export type TriggerAction = "copy-whole-page" | "start-picker";

/**
 * `CustomEvent` name dispatched by the popup (via `chrome.scripting
 * .executeScript`) and observed by the content script. Carries a
 * `TriggerAction` in `detail`.
 *
 * `executeScript` propagates the popup's user activation into the page's
 * isolated world; dispatching the event synchronously inside the injected
 * function preserves that activation through the listener call, so a
 * downstream `navigator.clipboard.write([ClipboardItem])` is allowed.
 */
export const TRIGGER_EVENT_NAME = "sleekdesign-copy-to-figma:trigger";

/**
 * Tag of the custom element that hosts our shadow-root UI. The conversion's
 * classify hook skips it so the extension's own DOM never bleeds into the
 * Figma payload.
 */
export const SHADOW_HOST_NAME = "sleek-copy-figma-ui";

/**
 * Subscribe to popup-driven trigger events. Returns an unsubscribe function.
 *
 * Pass `signal` (typically `ctx.signal` in a content script) to scope the
 * listener to a WXT context: when the extension is reloaded, disabled, or
 * updated, the signal aborts and the listener is removed automatically.
 */
export function onTriggerEvent(
  handler: (action: TriggerAction) => void,
  options?: { signal?: AbortSignal }
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<TriggerAction>).detail);
  };
  window.addEventListener(TRIGGER_EVENT_NAME, listener, options);
  return () => window.removeEventListener(TRIGGER_EVENT_NAME, listener);
}
