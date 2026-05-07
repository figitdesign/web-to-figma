import type { Position } from "../../dom";
import { getElementSize } from "../../dom";
import type { FontCache } from "../../font-cache";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
} from "../../types";
import { elementToFrameNodeChange } from "../frame";
import { nodeToTextNodeChange } from "../text";

type FormElementParams = {
  element: Element;
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  registerBlob: (blob: FigmaBlob) => number;
  inheritedProperties?: {
    textGradient?: Array<FigmaPaint>;
  };
  fontCache: FontCache;
  createGuid: () => FigmaGuid;
};

/**
 * Creates a synthetic div element with all computed styles from the form element
 */
function createStyledDiv(
  element: Element,
  placeholderText: string
): HTMLDivElement {
  const syntheticDiv = element.ownerDocument.createElement("div");
  const computedStyle = window.getComputedStyle(element);

  // Copy all CSS properties from the computed style
  let cssText = "";
  for (const property of computedStyle) {
    if (!property) {
      continue;
    }
    const value = computedStyle.getPropertyValue(property);

    if (property && value && value !== "") {
      cssText += `${property}: ${value}; `;
    }
  }

  syntheticDiv.style.cssText = cssText;

  // Override properties for proper text rendering
  syntheticDiv.style.setProperty("display", "block");
  syntheticDiv.style.setProperty("user-select", "text");
  syntheticDiv.style.setProperty("pointer-events", "none");
  // Opacity is applied on the parent frame; resetting here avoids it being multiplied.
  syntheticDiv.style.setProperty("opacity", "1");

  syntheticDiv.textContent = placeholderText;

  // Position for measurement
  const inputRect = element.getBoundingClientRect();
  syntheticDiv.style.position = "absolute";
  syntheticDiv.style.left = `${inputRect.left}px`;
  syntheticDiv.style.top = `${inputRect.top}px`;

  return syntheticDiv;
}

/**
 * Calculates proper text positioning within a form element
 */
function calculateTextPosition(element: Element): {
  position: Position;
  size: { width: number; height: number };
} {
  const computedStyle = window.getComputedStyle(element);
  const isTextarea = element.tagName.toLowerCase() === "textarea";

  // Extract padding and border values
  const paddingLeft = Number.parseInt(computedStyle.paddingLeft || "0", 10);
  const paddingTop = Number.parseInt(computedStyle.paddingTop || "0", 10);
  const paddingRight = Number.parseInt(computedStyle.paddingRight || "0", 10);
  const paddingBottom = Number.parseInt(computedStyle.paddingBottom || "0", 10);
  const borderLeftWidth = Number.parseInt(
    computedStyle.borderLeftWidth || "0",
    10
  );
  const borderTopWidth = Number.parseInt(
    computedStyle.borderTopWidth || "0",
    10
  );
  const borderRightWidth = Number.parseInt(
    computedStyle.borderRightWidth || "0",
    10
  );
  const borderBottomWidth = Number.parseInt(
    computedStyle.borderBottomWidth || "0",
    10
  );

  // Calculate font metrics
  const fontSize = Number.parseInt(computedStyle.fontSize || "16", 10);
  const lineHeight = computedStyle.lineHeight;

  let lineHeightPx = fontSize;
  if (lineHeight && lineHeight !== "normal") {
    if (lineHeight.endsWith("px")) {
      lineHeightPx = Number.parseInt(lineHeight, 10);
    } else if (lineHeight.includes(".") || !lineHeight.endsWith("px")) {
      lineHeightPx = fontSize * Number.parseFloat(lineHeight);
    }
  } else {
    lineHeightPx = fontSize * 1.2;
  }

  // Calculate dimensions
  const inputSize = getElementSize(element);
  const contentHeight =
    inputSize.height -
    paddingTop -
    paddingBottom -
    borderTopWidth -
    borderBottomWidth;

  // Calculate vertical positioning based on element type
  let textYOffset = 0;
  if (isTextarea) {
    // Textareas start text from the top
    textYOffset = 0;
  } else {
    // Inputs center their text vertically
    textYOffset = (contentHeight - lineHeightPx) / 2;
  }

  const position = {
    x: paddingLeft + borderLeftWidth,
    y: paddingTop + borderTopWidth + textYOffset,
  };

  const size = {
    width:
      inputSize.width -
      paddingLeft -
      paddingRight -
      borderLeftWidth -
      borderRightWidth,
    height:
      inputSize.height -
      paddingTop -
      paddingBottom -
      borderTopWidth -
      borderBottomWidth,
  };

  return { position, size };
}

/**
 * Converts a form element with placeholder text to Figma nodes
 */
export async function elementToFormNodeChange(
  params: FormElementParams
): Promise<Array<FigmaNodeChange>> {
  const {
    element,
    guid,
    parentGuid,
    childIndex,
    position,
    registerBlob,
    inheritedProperties,
    fontCache,
    createGuid,
  } = params;

  const placeholderText = element.getAttribute("placeholder")?.trim();
  if (!placeholderText) {
    throw new Error("Form element has no placeholder text");
  }

  const nodeChanges: Array<FigmaNodeChange> = [];

  // Create the frame for the form element (border, background, etc.)
  const frameResult = elementToFrameNodeChange(element, {
    guid,
    parentGuid,
    childIndex,
    position,
  });

  nodeChanges.push(frameResult.nodeChange);

  // Create synthetic div for text styling
  const syntheticDiv = createStyledDiv(element, placeholderText);
  document.body.appendChild(syntheticDiv);

  try {
    // Calculate text positioning and sizing
    const { position: textPosition, size: textSize } =
      calculateTextPosition(element);

    // Create text node for placeholder
    const textGuid = createGuid();
    const textNodeChange = await nodeToTextNodeChange(syntheticDiv, {
      guid: textGuid,
      parentGuid: guid,
      childIndex: 0,
      position: textPosition,
      size: textSize,
      textContent: placeholderText,
      registerBlob,
      inheritedProperties,
      fontCache,
    });

    nodeChanges.push(textNodeChange);
  } finally {
    // Always clean up the synthetic element
    document.body.removeChild(syntheticDiv);
  }

  return nodeChanges;
}
