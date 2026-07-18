import type { ElementKind } from "./classify";
import type { FigmaGuid } from "./types";

/**
 * A single entry in a {@link ConvertTrace}: the link from one emitted Figma
 * node to the DOM element (or text node) it came from. Produced only when the
 * converter is created with `{ trace: true }`. Consumed by the visual-parity
 * harness to attribute discrepancies back to source DOM.
 */
export type TraceEntry = {
  /** GUID of the emitted node change this entry describes. */
  guid: FigmaGuid;
  /** Classified kind for the source element; always `"text"` for text nodes. */
  kind: ElementKind;
  /** Lowercase tag name of the source element; `"#text"` for text nodes. */
  tag: string;
  /**
   * Selector that resolves the source element from the scene root, built
   * incrementally from real DOM child positions, e.g.
   * `:scope > div:nth-child(2) > p:nth-child(1)`. The root element itself is
   * `:scope`. Text nodes carry their owner element's path plus a
   * `::text[i]` suffix (not a valid CSS selector — strip it to resolve the
   * owner element); every line segment of one text node shares that path.
   */
  domPath: string;
  /** Source rect in viewport coordinates at convert time (`getBoundingClientRect`). */
  rect: { x: number; y: number; width: number; height: number };
  /** First 120 characters of the rendered text; text nodes only. */
  text?: string;
};

/** The full trace for one `convert()` call. Exposed as `ConvertResult.trace`. */
export type ConvertTrace = {
  /** Root frame GUID the traced nodes descend from. */
  rootGuid: FigmaGuid;
  entries: Array<TraceEntry>;
};

/** Records trace entries during a walk; `undefined` disables tracing entirely. */
export type TraceRecorder = (entry: TraceEntry) => void;

/**
 * Selector segment for an element, appended to its parent's path. The root
 * element (empty `parentDomPath`) is `:scope`; every other element is
 * positioned by its real 1-based index among its parent's element children,
 * so the result resolves via `root.querySelector(...)` regardless of the
 * converter's emission order.
 */
export function elementDomPath(
  element: Element,
  parentDomPath: string
): string {
  if (parentDomPath === "") {
    return ":scope";
  }
  const parent = element.parentElement;
  const index = parent ? Array.from(parent.children).indexOf(element) + 1 : 1;
  return `${parentDomPath} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
}

/** Owner path for a text node: its parent element's path plus a `::text[i]`
 * ordinal identifying the text node among its parent's child nodes. */
export function textDomPath(textNode: Text, parentDomPath: string): string {
  const parent = textNode.parentNode;
  const index = parent ? Array.from(parent.childNodes).indexOf(textNode) : 0;
  return `${parentDomPath}::text[${index}]`;
}
