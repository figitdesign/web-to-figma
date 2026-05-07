import type { Classify, FigmaConverter } from "@sleekdesign/dom-to-figma";
import {
  createFigmaConverter,
  defaultClassify,
} from "@sleekdesign/dom-to-figma";

import { controller } from "../../shared/controller";
import {
  createBackgroundImageLoader,
  createSleekFontLoader,
} from "../../shared/loaders";

let converter: FigmaConverter | null = null;

function getConverter(): FigmaConverter {
  if (converter) {
    return converter;
  }
  converter = createFigmaConverter({
    fontLoader: createSleekFontLoader(),
    imageLoader: createBackgroundImageLoader(),
    classify: skipExtensionUiClassify,
  });
  return converter;
}

/**
 * Skip our own shadow-root UI host so it never ends up in the conversion. The
 * default classify is otherwise reused unchanged.
 */
const skipExtensionUiClassify: Classify = (element) => {
  if (
    element instanceof HTMLElement &&
    element.tagName.toLowerCase() === "sleek-copy-figma-ui"
  ) {
    return "skip";
  }
  // Cross-origin iframes can't be inspected from the parent context (security
  // error on `contentDocument`), so the converter has nothing to walk. Skip
  // them rather than crashing on the inner getComputedStyle calls.
  if (element instanceof HTMLIFrameElement && !isSameOriginIframe(element)) {
    return "skip";
  }
  return defaultClassify(element);
};

function isSameOriginIframe(iframe: HTMLIFrameElement): boolean {
  try {
    // Throws SecurityError on cross-origin.
    return iframe.contentDocument !== null;
  } catch {
    return false;
  }
}

export async function copyWholePage(): Promise<void> {
  const root = document.documentElement;
  const width = root.scrollWidth;
  const height = root.scrollHeight;
  await runConversion({
    element: document.body,
    width,
    height,
    name: deriveFrameName(),
  });
}

export async function copyElement(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    controller.dispatch({
      type: "show-toast",
      kind: "error",
      message: "Selected element has no size to copy.",
    });
    return;
  }
  await runConversion({
    element,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    name: deriveFrameName(element),
  });
}

async function runConversion({
  element,
  width,
  height,
  name,
}: {
  element: Element;
  width: number;
  height: number;
  name: string;
}): Promise<void> {
  controller.dispatch({
    type: "show-toast",
    kind: "info",
    message: "Copying to Figma…",
    durationMs: 30_000,
  });
  try {
    const result = await getConverter().convert({
      element,
      width,
      height,
      name,
    });
    await navigator.clipboard.write([result.toClipboardItem()]);
    controller.dispatch({
      type: "show-toast",
      kind: "success",
      message: "Copied. Paste in Figma with ⌘V / Ctrl+V.",
    });
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: dev diagnostic — user-facing error is the toast below
    console.error("[copy-to-figma] convert failed", error);
    controller.dispatch({
      type: "show-toast",
      kind: "error",
      message:
        error instanceof Error
          ? `Copy failed: ${error.message}`
          : "Copy failed.",
    });
  }
}

function deriveFrameName(element?: HTMLElement): string {
  if (element) {
    const id = element.id ? `#${element.id}` : "";
    const cls = element.classList.length ? `.${element.classList[0]}` : "";
    const tag = element.tagName.toLowerCase();
    return `${tag}${id}${cls}` || "Selection";
  }
  return document.title || location.hostname || "Page";
}
