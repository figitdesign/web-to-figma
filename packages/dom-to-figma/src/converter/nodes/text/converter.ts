import type { Position, Size } from "../../dom";
import { getElementSize, getTextSize, isTextNode } from "../../dom";
import type { FontCache } from "../../font-cache";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import { cssBackgroundToFigmaPaints } from "../../styles/gradient";
import { parseOpacity } from "../../styles/opacity";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaPaint,
  FigmaTextAlignHorizontal,
  FigmaTextCase,
  FigmaTextDecoration,
  FigmaTextNodeChange,
} from "../../types";
import { buildBaselines } from "./builders/baselines";
import { buildCharacterOffsets } from "./builders/character-offsets";
import { processTextDecorations } from "./builders/decorations";
import { parseTextProperties } from "./primitives/css/parser";
import { processGlyphs } from "./primitives/glyph/processor";
import { processTextLayout } from "./primitives/layout/processor";

const cssToFigmaTextAlignHorizontalMap: Record<
  string,
  FigmaTextAlignHorizontal
> = {
  left: "LEFT",
  center: "CENTER",
  right: "RIGHT",
  justify: "JUSTIFIED",
};

const fontWeightToWidthBufferMap: Record<number, number> = {
  100: 0,
  200: 0,
  300: 0,
  400: 2,
  500: 2,
  600: 2,
  700: 3,
  800: 4,
  900: 5,
};

function getWidthBuffer(fontWeight: number, fontSize: number) {
  const fontWeightBuffer = fontWeightToWidthBufferMap[fontWeight] ?? 0;
  return fontSize > 60 ? fontWeightBuffer + 1 : fontWeightBuffer;
}

const cssToFigmaTextDecorationMap: Record<string, FigmaTextDecoration> = {
  none: "NONE",
  underline: "UNDERLINE",
};

const cssToFigmaTextCaseMap: Record<string, FigmaTextCase> = {
  none: "ORIGINAL",
  uppercase: "UPPER",
  lowercase: "LOWER",
  capitalize: "TITLE",
};

function applyCssTextTransform(text: string, transform: string): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|\s)(\S)/g, (_, sp, c) => sp + c.toUpperCase());
    default:
      return text;
  }
}

// Detects whether the browser laid out the text on a single visual line.
// Each visual line produces at least one client rect; we group by `top`
// (tolerating sub-pixel jitter) to count distinct lines.
function isTextOnSingleLine(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);

  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width && r.height
  );

  const topJitterTolerance = 1;
  const lineTops: Array<number> = [];
  for (const rect of rects) {
    if (
      !lineTops.some((top) => Math.abs(top - rect.top) < topJitterTolerance)
    ) {
      lineTops.push(rect.top);
    }
  }
  return lineTops.length <= 1;
}

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  size?: Size;
  textContent?: string;
  registerBlob: (blob: FigmaBlob) => number;
  inheritedProperties?: {
    textGradient?: Array<FigmaPaint>;
  };
  fontCache: FontCache;
};

export async function nodeToTextNodeChange(
  node: Element | Text,
  options: Params
): Promise<FigmaTextNodeChange> {
  const {
    guid,
    parentGuid,
    childIndex,
    position,
    registerBlob,
    size,
    inheritedProperties,
    textContent,
    fontCache,
  } = options;
  const isTextNodeValue = isTextNode(node);

  // If the node is a text node, use the parent element for getting the computed style, otherwise use the node itself
  const element = isTextNodeValue ? node.parentElement : node;

  if (!element) {
    throw new Error("Element not found");
  }

  const computedStyle = window.getComputedStyle(element);

  const defaultTextContent = node.textContent?.trim() ?? "";
  const rawText = textContent ?? defaultTextContent;

  const defaultSize = isTextNodeValue
    ? getTextSize(node)
    : getElementSize(element);
  const nodeSize = size ?? defaultSize;

  const baseWidth = nodeSize.width;
  const baseHeight = nodeSize.height;

  const fontSize = Number.parseFloat(computedStyle.fontSize || "16");
  const fontFamily =
    computedStyle.fontFamily.replace(/["']/g, "").split(",")[0]?.trim() ?? "";
  const fontWeight = Number.parseInt(computedStyle.fontWeight, 10);
  const textAlign =
    cssToFigmaTextAlignHorizontalMap[computedStyle.textAlign] ?? "LEFT";
  const color = cssColorToFigmaColor(computedStyle.color);

  // Check for gradient backgrounds in text (for gradient text effects)
  const backgroundImage =
    computedStyle.backgroundImage || computedStyle.background;

  const fillPaints: Array<FigmaPaint> = [];

  // Prioritize inherited text gradient from parent with background-clip: text
  if (
    inheritedProperties?.textGradient &&
    inheritedProperties.textGradient.length > 0
  ) {
    fillPaints.push(...inheritedProperties.textGradient);
  }
  // Check for gradients first. Only apply gradient if the color is transparent (that's how text gradient works in CSS)
  else if (backgroundImage && backgroundImage !== "none" && color === null) {
    const gradientPaints = cssBackgroundToFigmaPaints(backgroundImage);
    fillPaints.push(...gradientPaints);
  }
  // Add solid color if present and no gradients found
  else if (color) {
    fillPaints.push(createSolidPaint(color.color, color.opacity));
  }

  // Check for text decoration on current element and parent elements
  let textDecoration = computedStyle.textDecorationLine || "none";

  // If no decoration found on current element, recursively check parent elements
  if (textDecoration === "none") {
    let parentElement = element.parentElement;
    while (parentElement) {
      const parentStyle = window.getComputedStyle(parentElement);
      const parentDecoration = parentStyle.textDecorationLine || "none";

      if (parentDecoration !== "none") {
        textDecoration = parentDecoration;
        break;
      }
      parentElement = parentElement.parentElement;
    }
  }

  const figmaTextDecoration =
    cssToFigmaTextDecorationMap[textDecoration] ?? "NONE";

  // Parse text transform (text case)
  const textTransform = computedStyle.textTransform || "none";
  const figmaTextCase = cssToFigmaTextCaseMap[textTransform] ?? "ORIGINAL";

  const text = applyCssTextTransform(rawText, textTransform);

  // It's generally more accurate to use the actual box height as the line height, but this doesn't work for text on multiple lines,
  // so in that case we use the computed line height.
  const computedLineHeight =
    computedStyle.lineHeight !== "normal"
      ? Number.parseFloat(computedStyle.lineHeight)
      : fontSize * 1.2;

  const lineHeight = computedLineHeight;

  // Whether the browser actually wrapped this text. If it didn't, we must not
  // wrap it in `derivedTextData` either — OpenType.js's metrics differ slightly
  // from the browser's and can spuriously break a line that fits in the DOM.
  const isSingleLine = isTextOnSingleLine(node);

  const letterSpacing =
    computedStyle.letterSpacing !== "normal"
      ? Number.parseFloat(computedStyle.letterSpacing)
      : 0;

  const widthBuffer = getWidthBuffer(fontWeight, fontSize);

  const adjustedSize = {
    width: baseWidth + widthBuffer,
    height: baseHeight,
  };

  const adjustedPosition = {
    x: position.x - widthBuffer / 2,
    // Need this max because of browser text alignment issues
    y: Math.max(0, position.y),
  };

  const { font, ...styles } = parseTextProperties(element);

  const loadedFont = await fontCache.get(font);

  // Apply width buffer to container width for wrapping calculations
  // This accounts for font metric differences between browser and OpenType.js
  const wrappingContainerWidth = styles.dimensions.width + widthBuffer;

  const layout = processTextLayout(loadedFont.font, text, {
    fontSize: styles.fontSize,
    spacing: { letterSpacing: styles.letterSpacing },
    alignment: styles.textAlign,
    containerWidth: wrappingContainerWidth,
    lineHeight: styles.lineHeight,
    wrapping: {
      enabled: true,
      wordWrap: !isSingleLine,
      breakWords: false,
    },
  });

  const glyphs = processGlyphs(
    loadedFont,
    text,
    {
      fontSize: styles.fontSize,
      includeWhitespace: true,
    },
    registerBlob
  );

  const baselines = buildBaselines(
    layout,
    styles.fontSize,
    styles.textAlign,
    styles.dimensions.width,
    loadedFont.metrics
  );

  const characterOffsets = buildCharacterOffsets(layout);

  // Process text decorations (underlines, etc.) - implement strikethrough later
  const decorationType =
    figmaTextDecoration === "UNDERLINE" ? "underline" : "none";

  const decorations = processTextDecorations(layout, loadedFont.font, text, {
    decorationType,
    fontSize: styles.fontSize,
    respectGlyphDescent: true,
  });

  // Build textData and derivedTextData
  const result = {
    textData: {
      characters: text,
      lines: [
        {
          lineType: "PLAIN" as const,
          styleId: 0,
          indentationLevel: 0,
          sourceDirectionality: "AUTO" as const,
          listStartOffset: 0,
          isFirstLineOfList: false,
        },
      ],
    },
    derivedTextData: {
      layoutSize: {
        x: layout.bounds.width,
        y: layout.bounds.height,
      },
      baselines: baselines.map((baseline, index) => {
        let lineWidth = 0;
        let baselineX = 0;
        const lineHeight = styles.lineHeight;
        let lineY = 0;
        const firstCharacter = baseline.characterStart;
        const endCharacter = baseline.characterEnd;

        if (layout.isMultiLine && layout.multiLineLayout) {
          // For multi-line text, get width from the specific line
          const line = layout.multiLineLayout.lines[index];
          lineWidth = line ? line.width : 0;
          lineY = index * lineHeight;

          // Calculate X position based on alignment
          // Use wrappingContainerWidth to match the container width used for glyph positioning
          if (styles.textAlign !== "left" && wrappingContainerWidth) {
            switch (styles.textAlign) {
              case "center":
                if (lineWidth < wrappingContainerWidth) {
                  baselineX = (wrappingContainerWidth - lineWidth) / 2;
                }
                break;
              case "right":
                baselineX = wrappingContainerWidth - lineWidth;
                break;
              default: {
                throw new Error("Invalid text align");
              }
            }
          }
        } else {
          // For single-line text, use the overall bounds width
          lineWidth = layout.bounds.width;
          lineY = 0;

          // Calculate X position based on alignment
          // Use wrappingContainerWidth to match the container width used for glyph positioning
          if (
            styles.textAlign !== "left" &&
            !layout.isMultiLine &&
            wrappingContainerWidth
          ) {
            switch (styles.textAlign) {
              case "center":
                if (lineWidth < wrappingContainerWidth) {
                  baselineX = (wrappingContainerWidth - lineWidth) / 2;
                }
                break;
              case "right":
                baselineX = wrappingContainerWidth - lineWidth;
                break;
              default: {
                throw new Error("Invalid text align");
              }
            }
          }
        }

        return {
          position: {
            x: baselineX,
            y: baseline.baseline,
          },
          width: lineWidth,
          lineY,
          lineHeight,
          lineAscent:
            (loadedFont.metrics.ascender / loadedFont.metrics.unitsPerEm) *
            styles.fontSize,
          firstCharacter,
          endCharacter,
        };
      }),
      glyphs: layout.positions.map((pos, i) => {
        const glyphData = glyphs.glyphDataMap.get(pos.character);
        const glyphPosition = {
          commandsBlob: glyphData?.registeredBlobIndex ?? 0,
          position: {
            x: pos.x,
            y: pos.y,
          },
          fontSize: styles.fontSize,
          firstCharacter: i,
          advance: pos.advance / styles.fontSize,
          rotation: 0.0,
        };

        return glyphPosition;
      }),
      fontMetaData: [
        {
          key: {
            family: loadedFont.properties.family,
            style: loadedFont.fontStyleName,
            // Figma writes its FontMetaData entries with an empty postscript
            // even when the top-level fontName carries one. Match that so a
            // round-trip looks identical and Figma's font matching (which is
            // by family + style + weight) takes the same path on both sides.
            postscript: "",
          },
          // Intrinsic line-height ratio of the font, NOT the user's chosen
          // line-height in pixels. The user's line-height already lives on
          // `nc.lineHeight` above. See `FontMetrics.lineHeightRatio`.
          fontLineHeight: loadedFont.metrics.lineHeightRatio,
          fontStyle: loadedFont.actualItalic
            ? ("ITALIC" as const)
            : ("NORMAL" as const),
          fontWeight: loadedFont.actualWeight ?? loadedFont.properties.weight,
        },
      ],
      truncationStartIndex: -1,
      truncatedHeight: -1.0,
      logicalIndexToCharacterOffsetMap: characterOffsets,
      derivedLines: [
        {
          directionality: "LTR" as const,
        },
      ],
      ...(decorations.length > 0 && { decorations }),
    },
  };

  const nodeChange: FigmaTextNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "TEXT",
    name: text,
    visible: true,
    opacity: parseOpacity(computedStyle.opacity),

    /* Size and Position */
    size: {
      x: adjustedSize.width,
      y: adjustedSize.height,
    },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: adjustedPosition.x,
      m10: 0.0,
      m11: 1.0,
      m12: adjustedPosition.y,
    },

    /* Text */
    characters: text,

    /* Alignment */
    textAlignHorizontal: textAlign,
    textAlignVertical: "TOP",

    /* Font */
    fontSize,
    lineHeight: {
      value: lineHeight,
      units: "PIXELS",
    },
    fontName: {
      family: fontFamily,
      style: loadedFont.fontStyleName,
      postscript: loadedFont.postScriptName,
    },
    letterSpacing: {
      value: letterSpacing,
      units: "PIXELS",
    },

    /* Text Data */
    textData: result.textData,
    derivedTextData: result.derivedTextData,

    /* Stroke */
    strokeWeight: 1.0,
    strokeAlign: "OUTSIDE",
    strokeJoin: "MITER",

    /* Fill */
    fillPaints,

    /* Text Decoration */
    ...(figmaTextDecoration !== "NONE" && {
      textDecoration: figmaTextDecoration,
    }),

    /* Text Case */
    ...(figmaTextCase !== "ORIGINAL" && {
      textCase: figmaTextCase,
    }),

    /* Other */
    // CSS `font-variant-ligatures: normal` (the default) enables common and
    // contextual ligatures only. Discretionary and historical ligatures are
    // off unless the author opts in — match that here.
    fontVariantCommonLigatures: true,
    fontVariantContextualLigatures: true,
    fontVariantDiscretionaryLigatures: false,
    fontVersion: "2",
    textUserLayoutVersion: 4,
    textExplicitLayoutVersion: 1,
    textBidiVersion: 1,
    // Note: we deliberately do not emit `textAutoResize`. The right value
    // depends on whether the source DOM wrapped (`HEIGHT` — lock width,
    // grow height) or rendered on a single line (`WIDTH_AND_HEIGHT` is
    // safe). Emitting `WIDTH_AND_HEIGHT` unconditionally causes Figma to
    // un-wrap multi-line text on re-derivation and clip it against the
    // parent frame. Leaving the field unset gives Figma its default (NONE),
    // which preserves whatever we measured.
    autoRename: true,
  };

  return nodeChange;
}
