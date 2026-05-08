/**
 * HTML envelope Figma reads when you paste from the system clipboard.
 *
 * The wire format is two HTML comments — Figma scans pasted HTML for these
 * markers and decodes the inner base64 payloads. No surrounding `<html>`,
 * `<body>`, or `<span>` scaffolding is required (verified against the actual
 * Figma reader).
 *
 *   <!--(figmeta)<base64-json>(/figmeta)-->
 *   <!--(figma)<base64-bytes>(/figma)-->
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
  return `<!--(figmeta)${metaB64}(/figmeta)--><!--(figma)${base64}(/figma)-->`;
}

/** Wrap envelope HTML in a `ClipboardItem` for `navigator.clipboard.write`. */
export function toClipboardItem(html: string): ClipboardItem {
  const blob = new Blob([html], { type: "text/html" });
  return new ClipboardItem({ "text/html": blob });
}
