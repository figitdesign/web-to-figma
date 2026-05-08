import type { Classify, FigmaConverter } from "@sleekdesign/dom-to-figma";
import {
  createFigmaConverter,
  createFontsourceLoader,
  defaultClassify,
} from "@sleekdesign/dom-to-figma";
import { toast } from "sonner";

import { toErrorMessage } from "../../shared/errors";
import { createBackgroundImageLoader } from "../../shared/loaders";
import { createPageFontLoader } from "../../shared/page-font-loader";
import { SHADOW_HOST_NAME } from "../../shared/triggers";

const COPY_TOAST_ID = "copy-to-figma";
const NOOP = () => {
  // intentional: default cleanup callback when nothing was set up
};

const getConverter: () => FigmaConverter = (() => {
  let instance: FigmaConverter | null = null;
  return () => {
    if (!instance) {
      instance = createFigmaConverter({
        // Try the page's own @font-face URLs first (browser cache hits for
        // free, exact metrics + postScriptName) and fall back to fontsource
        // for anything we couldn't match or parse on the page.
        fontLoader: createPageFontLoader({
          fallbackLoader: createFontsourceLoader(),
        }),
        imageLoader: createBackgroundImageLoader(),
        classify: skipExtensionUiClassify,
      });
    }
    return instance;
  };
})();

const skipExtensionUiClassify: Classify = (element) => {
  if (
    element instanceof HTMLElement &&
    element.tagName.toLowerCase() === SHADOW_HOST_NAME
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
  const restoreBackground = applyInheritedBackgroundIfNeeded(element);
  runConversion(
    {
      element,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      name: deriveElementFrameName(element),
    },
    restoreBackground
  );
}

type ConversionInput = {
  element: Element;
  width: number;
  height: number;
  name: string;
};

function runConversion(
  input: ConversionInput,
  onComplete: () => void = NOOP
): void {
  // toast.promise shows a loading toast, then swaps it in place to a success
  // or error toast — the same { id } guarantees no stacking.
  toast.promise(convertAndCopy(input).finally(onComplete), {
    id: COPY_TOAST_ID,
    loading: "Copying to Figma…",
    success: "Copied. Paste in Figma with ⌘V / Ctrl+V.",
    error: (error) => `Copy failed: ${toErrorMessage(error, "unknown error")}`,
  });
}

async function convertAndCopy(input: ConversionInput): Promise<void> {
  const result = await getConverter().convert(input);
  await navigator.clipboard.write([result.toClipboardItem()]);
}

/**
 * If the picked element has no background of its own, walk up the parent
 * chain to find the first opaque ancestor and apply its color inline for
 * the duration of the conversion. The page already shows that color through
 * the transparent element, so the assignment doesn't change a single
 * rendered pixel — but it gives dom-to-figma the right fill for the
 * extracted Figma frame, which would otherwise sit on a transparent
 * canvas. Returns a no-op when no inheritance is needed.
 *
 * Limitations: only solid colors are carried over. Background images,
 * gradients, and semi-transparent stacks on parents are dropped — composing
 * those into a single fill would require sampling rendered pixels.
 */
function applyInheritedBackgroundIfNeeded(element: HTMLElement): () => void {
  if (!isTransparentColor(getComputedStyle(element).backgroundColor)) {
    return NOOP;
  }
  const inherited = findInheritedBackground(element);
  if (!inherited) {
    return NOOP;
  }
  const previous = element.style.backgroundColor;
  element.style.backgroundColor = inherited;
  return () => {
    element.style.backgroundColor = previous;
  };
}

function findInheritedBackground(element: HTMLElement): string | null {
  let current = element.parentElement;
  while (current) {
    const bg = getComputedStyle(current).backgroundColor;
    if (!isTransparentColor(bg)) {
      return bg;
    }
    current = current.parentElement;
  }
  return null;
}

function isTransparentColor(color: string): boolean {
  if (!color || color === "transparent") {
    return true;
  }
  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return false;
  }
  const parts = match[1].split(",").map((s) => s.trim());
  if (parts.length !== 4) {
    return false;
  }
  return Number.parseFloat(parts[3]) === 0;
}

function deriveElementFrameName(element: HTMLElement): string {
  const id = element.id ? `#${element.id}` : "";
  const cls = element.classList.length ? `.${element.classList[0]}` : "";
  return `${element.tagName.toLowerCase()}${id}${cls}`;
}

function derivePageFrameName(): string {
  return document.title || location.hostname || "Page";
}
