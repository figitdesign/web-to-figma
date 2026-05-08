export type FigmaTextAlignHorizontal =
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "JUSTIFIED";

export type FigmaTextDecoration = "NONE" | "UNDERLINE" | "STRIKETHROUGH";

export type FigmaTextCase =
  | "ORIGINAL"
  | "UPPER"
  | "LOWER"
  | "TITLE"
  | "SMALL_CAPS"
  | "SMALL_CAPS_FORCED";

export type FigmaTextData = {
  characters: string;
  lines?: Array<unknown>;
};

export type FigmaDerivedTextData = {
  layoutSize?: {
    x: number;
    y: number;
  };
  layoutVersion?: number;
  derivedLines: Array<{
    directionality: "LTR" | "RTL";
  }>;
  fontMetaData?: Array<{
    key: {
      family: string;
      style: string;
      postscript: string;
    };
    fontDigest?: Array<number>;
    fontWeight: number;
    fontLineHeight: number;
    fontStyle: "NORMAL" | "ITALIC";
  }>;
  baselines?: Array<{
    position: { x: number; y: number };
    width: number;
    lineY: number;
    lineHeight: number;
    lineAscent: number;
    firstCharacter: number;
    endCharacter: number;
  }>;
  glyphs?: Array<{
    commandsBlob: number;
    position: { x: number; y: number };
    fontSize: number;
    firstCharacter: number;
    advance: number;
    rotation: number;
  }>;
  truncationStartIndex?: number;
  truncatedHeight?: number;
  logicalIndexToCharacterOffsetMap?: Array<number>;
};
