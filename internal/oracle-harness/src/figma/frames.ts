import { decodeFigmaData, parseClipboardHtml } from "@figit/fig-kiwi";

type DecodedNode = {
  type?: string;
  name?: string;
  parentIndex?: { guid: { localID: number } };
};

// Figma's clipboard payload nests canvas-level frames directly under the
// internal canvas node (localID 1).
const CANVAS_LOCAL_ID = 1;

/** Top-level frame names in a Figma clipboard payload. Pure. Returns `[]` when
 * the html carries no figma buffer (e.g. an empty-canvas copy). */
export function extractTopFrameNames(html: string): Array<string> {
  if (!html.includes("(figma)")) {
    return [];
  }
  const decoded = decodeFigmaData(parseClipboardHtml(html).fig);
  const changes = decoded.message.nodeChanges as Array<DecodedNode>;
  return changes
    .filter(
      (c) =>
        c.type === "FRAME" && c.parentIndex?.guid.localID === CANVAS_LOCAL_ID
    )
    .map((c) => c.name ?? "?");
}
