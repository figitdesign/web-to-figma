import { TRANSPARENT_COLOR_VALUES } from "./styles/color";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// SVG elements that are only ever referenced, never drawn where they stand. Compared lowercased:
// `tagName` keeps an SVG element's case, so "clipPath" never matched a lowercased name, and a clip
// shape outside <defs> pasted as a visible shape (a <symbol>'s, <mask>'s or <pattern>'s likewise).
const SVG_REFERENCED_ONLY = new Set([
  "clippath",
  "mask",
  "symbol",
  "pattern",
  "marker",
  "lineargradient",
  "radialgradient",
  "filter",
]);

export type ElementKind =
  | "skip"
  | "group"
  | "frame"
  | "vector"
  | "image"
  | "text"
  | "form-with-placeholder";

export function defaultClassify(element: Element): ElementKind {
  if (isNonVisualElement(element)) {
    return "skip";
  }
  if (isHiddenElement(element)) {
    return "skip";
  }
  if (isGroupElement(element)) {
    return "group";
  }
  if (isSvgShapeElement(element)) {
    return "vector";
  }
  if (isImageElement(element)) {
    return "image";
  }
  if (isPlainTextElement(element)) {
    return "text";
  }
  if (isFormElementWithPlaceholder(element) && hasPlaceholderText(element)) {
    return "form-with-placeholder";
  }
  return "frame";
}

function isNonVisualElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "script" ||
    tagName === "style" ||
    tagName === "head" ||
    tagName === "meta" ||
    tagName === "title" ||
    tagName === "link" ||
    tagName === "noscript" ||
    tagName === "template" ||
    tagName === "comment" ||
    tagName === "defs" ||
    tagName === "desc" ||
    (element.namespaceURI === SVG_NAMESPACE && SVG_REFERENCED_ONLY.has(tagName))
  );
}

function isHiddenElement(element: Element): boolean {
  const computedStyle = window.getComputedStyle(element);

  if (computedStyle.display === "none") {
    return true;
  }

  const clip = computedStyle.clip;
  if (clip === "rect(0px, 0px, 0px, 0px)" || clip === "rect(0, 0, 0, 0)") {
    return true;
  }

  return false;
}

function isGroupElement(element: Element): boolean {
  return element.tagName.toLowerCase() === "g";
}

function isSvgShapeElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "path" ||
    tagName === "circle" ||
    tagName === "rect" ||
    tagName === "ellipse" ||
    tagName === "line" ||
    tagName === "polyline" ||
    tagName === "polygon"
  );
}

function isImageElement(element: Element): boolean {
  return element.tagName.toLowerCase() === "img";
}

/**
 * A plain text element is a leaf with text content and no painted box of its
 * own (no padding, border, or background). The whole element is treated as
 * text rather than a frame containing text.
 */
function isPlainTextElement(element: Element): boolean {
  const computedStyle = window.getComputedStyle(element);
  const hasText = !!(element.textContent || "").trim().length;
  const isTransparent = TRANSPARENT_COLOR_VALUES.includes(
    computedStyle.backgroundColor
  );
  const hasNoPadding = computedStyle.padding === "0px";
  const hasNoBorder = computedStyle.borderWidth === "0px";

  return (
    hasText &&
    element.children.length === 0 &&
    isTransparent &&
    hasNoPadding &&
    hasNoBorder
  );
}

const FORM_PLACEHOLDER_EXCLUDED_TYPES = [
  "checkbox",
  "radio",
  "submit",
  "button",
  "file",
  "hidden",
];

function isFormElementWithPlaceholder(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const inputType = (element as HTMLInputElement).type?.toLowerCase() || "";

  return (
    (tagName === "input" &&
      !FORM_PLACEHOLDER_EXCLUDED_TYPES.includes(inputType)) ||
    tagName === "textarea"
  );
}

function hasPlaceholderText(element: Element): boolean {
  const placeholder = element.getAttribute("placeholder");
  return !!(placeholder && placeholder.trim().length > 0);
}
