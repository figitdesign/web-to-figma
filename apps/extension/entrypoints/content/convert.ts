import type { Classify, FigmaConverter } from "@sleekdesign/dom-to-figma";
import {
  createFigmaConverter,
  createFontsourceLoader,
  defaultClassify,
} from "@sleekdesign/dom-to-figma";
import { toast } from "sonner";

import { toErrorMessage } from "../../shared/errors";
import { createBackgroundImageLoader } from "../../shared/loaders";

const COPY_TOAST_ID = "copy-to-figma";
const SHADOW_HOST_TAG = "sleek-copy-figma-ui";

let converter: FigmaConverter | null = null;

function getConverter(): FigmaConverter {
  if (!converter) {
    converter = createFigmaConverter({
      fontLoader: createFontsourceLoader(),
      imageLoader: createBackgroundImageLoader(),
      classify: skipExtensionUiClassify,
    });
  }
  return converter;
}

const skipExtensionUiClassify: Classify = (element) => {
  if (
    element instanceof HTMLElement &&
    element.tagName.toLowerCase() === SHADOW_HOST_TAG
  ) {
    return "skip";
  }
  // Cross-origin iframes can't be inspected from the parent context (security
  // error on `contentDocument`), so the converter has nothing to walk.
  if (element instanceof HTMLIFrameElement && !isSameOriginIframe(element)) {
    return "skip";
  }
  return defaultClassify(element);
};

function isSameOriginIframe(iframe: HTMLIFrameElement): boolean {
  try {
    return iframe.contentDocument !== null;
  } catch {
    return false;
  }
}

export function copyWholePage(): void {
  const root = document.documentElement;
  runConversion({
    element: document.body,
    width: root.scrollWidth,
    height: root.scrollHeight,
    name: derivePageFrameName(),
  });
}

export function copyElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    toast.error("Selected element has no size to copy.", { id: COPY_TOAST_ID });
    return;
  }
  runConversion({
    element,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    name: deriveElementFrameName(element),
  });
}

function runConversion(input: {
  element: Element;
  width: number;
  height: number;
  name: string;
}): void {
  // toast.promise shows a loading state, then swaps it in place to a success
  // or error toast — the same { id } guarantees no stacking.
  toast.promise(convertAndCopy(input), {
    id: COPY_TOAST_ID,
    loading: "Copying to Figma…",
    success: "Copied. Paste in Figma with ⌘V / Ctrl+V.",
    error: (error) => `Copy failed: ${toErrorMessage(error, "unknown error")}`,
  });
}

async function convertAndCopy(input: {
  element: Element;
  width: number;
  height: number;
  name: string;
}): Promise<void> {
  const result = await getConverter().convert(input);
  await navigator.clipboard.write([result.toClipboardItem()]);
}

function deriveElementFrameName(element: HTMLElement): string {
  const id = element.id ? `#${element.id}` : "";
  const cls = element.classList.length ? `.${element.classList[0]}` : "";
  return `${element.tagName.toLowerCase()}${id}${cls}`;
}

function derivePageFrameName(): string {
  return document.title || location.hostname || "Page";
}
