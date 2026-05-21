/**
 * HTML envelope Figma reads when you paste from the system clipboard.
 *
 * The wire format stores Figma's comment markers inside data attributes,
 * matching the HTML Figma writes when copying a node. Keeping the markers out
 * of top-level comment nodes is important for WebKit: Safari sanitizes
 * `text/html` clipboard writes and strips comment nodes before they reach the
 * system pasteboard.
 *
 *   <span data-metadata="<!--(figmeta)<base64-json>(/figmeta)-->"></span>
 *   <span data-buffer="<!--(figma)<base64-bytes>(/figma)-->"></span>
 */

export type FigmaClipboardMeta = {
  dataType: "scene";
  fileKey: string;
  pasteID: number;
};

const DEFAULT_META: FigmaClipboardMeta = {
  dataType: "scene",
  fileKey: "TEST",
  pasteID: 123,
};

/** Build the HTML clipboard envelope. No DOM required. */
export function composeClipboardHtml(
  base64: string,
  meta: FigmaClipboardMeta = DEFAULT_META
): string {
  const metaB64 = btoa(JSON.stringify(meta));
  return (
    '<meta charset="utf-8"><div>' +
    `<span data-metadata="<!--(figmeta)${metaB64}(/figmeta)-->"></span>` +
    `<span data-buffer="<!--(figma)${base64}(/figma)-->"></span>` +
    "</div>"
  );
}

/** Wrap envelope HTML in a `ClipboardItem` for `navigator.clipboard.write`. */
export function toClipboardItem(html: string): ClipboardItem {
  const blob = new Blob([html], { type: "text/html" });
  return new ClipboardItem({ "text/html": blob });
}
