/**
 * Actions invoked by the popup via `chrome.scripting.executeScript`. The
 * popup's user activation propagates through `executeScript` into the content
 * script's isolated world, which is what `navigator.clipboard.write` needs for
 * the figma-flavoured ClipboardItem (see `entrypoints/content`).
 */
export type TriggerAction = "copy-whole-page" | "start-picker";

/**
 * Global hook the content script installs on `window` so the popup's
 * `executeScript({ func })` payload can stay tiny and self-contained.
 */
export const TRIGGER_GLOBAL = "__sleekCopyFigmaTrigger" as const;
