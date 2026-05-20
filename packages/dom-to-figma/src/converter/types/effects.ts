import type { FigmaColor } from "./core";

type FigmaEffectType =
  | "INNER_SHADOW"
  | "DROP_SHADOW"
  | "FOREGROUND_BLUR"
  | "BACKGROUND_BLUR";

type FigmaBlendMode =
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

// Base effect properties shared by all effects
type FigmaEffectBase = {
  type: FigmaEffectType;
  visible: boolean;
  radius: number;
};

// Shadow effects require color, offset, blendMode, etc.
type FigmaShadowEffect = FigmaEffectBase & {
  type: "INNER_SHADOW" | "DROP_SHADOW";
  color: FigmaColor;
  offset: {
    x: number;
    y: number;
  };
  blendMode: FigmaBlendMode;
  spread?: number;
  showShadowBehindNode?: boolean;
};

// Blur effects only need type, visible, and radius
// (other fields are technically present in schema but not meaningfully used)
export type FigmaBlurEffect = FigmaEffectBase & {
  type: "FOREGROUND_BLUR" | "BACKGROUND_BLUR";
  // These fields exist in schema but are not meaningful for blur effects
  color?: FigmaColor;
  offset?: {
    x: number;
    y: number;
  };
  blendMode?: FigmaBlendMode;
  spread?: number;
  showShadowBehindNode?: boolean;
};

// Union type for all effects
export type FigmaEffect = FigmaShadowEffect | FigmaBlurEffect;
