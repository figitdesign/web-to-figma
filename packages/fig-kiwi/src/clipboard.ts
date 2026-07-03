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

export type ParsedClipboardHtml = {
  /** Raw fig-kiwi envelope bytes, ready for `decodeFigmaData`. */
  fig: Uint8Array;
  /** Parsed `(figmeta)` JSON, when present. */
  meta: FigmaClipboardMeta | null;
};

// Marker pairs appear either as real HTML comments (what Figma writes on
// copy) or inside data attributes (what we write; see module docs). Most HTML
// serializers — macOS NSPasteboard normalization, Chromium's clipboard write
// path — entity-encode `<` and `>` inside attribute values, so both raw and
// entity-encoded forms show up in the wild; normalize before searching.
const MARKERS = {
  figma: { start: "<!--(figma)", end: "(/figma)-->" },
  figmeta: { start: "<!--(figmeta)", end: "(/figmeta)-->" },
} as const;

function normalizeMarkers(html: string): string {
  let out = html;
  for (const { start, end } of Object.values(MARKERS)) {
    out = out
      .replaceAll(`&lt;${start.slice(1)}`, start)
      .replaceAll(`${end.slice(0, -1)}&gt;`, end);
  }
  return out;
}

function extractMarkedBase64(
  normalized: string,
  marker: (typeof MARKERS)[keyof typeof MARKERS]
): string | null {
  const start = normalized.indexOf(marker.start);
  const end = normalized.indexOf(marker.end);
  if (start === -1 || end === -1 || start > end) {
    return null;
  }
  return normalized.slice(start + marker.start.length, end);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract the fig-kiwi payload (and figmeta, when present) from a clipboard
 * HTML envelope — ours or one copied straight out of Figma.
 */
export function parseClipboardHtml(html: string): ParsedClipboardHtml {
  const normalized = normalizeMarkers(html);

  const figBase64 = extractMarkedBase64(normalized, MARKERS.figma);
  if (figBase64 === null) {
    const SAMPLE_LIMIT = 240;
    const sample =
      html.length > SAMPLE_LIMIT
        ? `${html.slice(0, SAMPLE_LIMIT)}… (truncated, ${html.length} bytes total)`
        : html || "(empty)";
    throw new Error(
      "Couldn't find Figma payload markers in clipboard HTML.\n" +
        "Make sure the HTML holds a copied Figma node (markers <!--(figma)…(/figma)--> expected).\n\n" +
        `Received:\n${sample}`
    );
  }

  const metaBase64 = extractMarkedBase64(normalized, MARKERS.figmeta);
  let meta: FigmaClipboardMeta | null = null;
  if (metaBase64 !== null) {
    try {
      meta = JSON.parse(atob(metaBase64)) as FigmaClipboardMeta;
    } catch {
      meta = null;
    }
  }

  return { fig: base64ToBytes(figBase64), meta };
}
