import type { FigmaNodeBlendMode } from "../types";

/**
 * CSS `mix-blend-mode` keywords that have an exact Figma blend mode. The two
 * `plus-*` keywords map to Figma's linear dodge/burn, which the Figma UI labels
 * "Plus Lighter"/"Plus Darker". `normal` is deliberately absent: leaving the
 * node's default `PASS_THROUGH` is what actually reproduces it (see
 * {@link cssMixBlendModeToFigmaBlendMode}).
 */
const MIX_BLEND_MODES: Record<string, FigmaNodeBlendMode> = {
  multiply: "MULTIPLY",
  screen: "SCREEN",
  overlay: "OVERLAY",
  darken: "DARKEN",
  lighten: "LIGHTEN",
  "color-dodge": "COLOR_DODGE",
  "color-burn": "COLOR_BURN",
  "hard-light": "HARD_LIGHT",
  "soft-light": "SOFT_LIGHT",
  difference: "DIFFERENCE",
  exclusion: "EXCLUSION",
  hue: "HUE",
  saturation: "SATURATION",
  color: "COLOR",
  luminosity: "LUMINOSITY",
  "plus-lighter": "LINEAR_DODGE",
  "plus-darker": "LINEAR_BURN",
};

/**
 * Convert a CSS `mix-blend-mode` value to the Figma node blend mode that
 * reproduces it.
 *
 * Returns null for `normal` and for keywords Figma cannot express, so the
 * caller omits the field and the node keeps Figma's `PASS_THROUGH` default.
 * `PASS_THROUGH` — not `NORMAL` — is the right default: `NORMAL` makes a frame
 * isolate its contents into their own group before compositing, which changes
 * how blended *descendants* reach the backdrop.
 *
 * @param mixBlendMode - The computed CSS `mix-blend-mode` value.
 * @returns The matching Figma blend mode, or null to leave the default.
 */
export function cssMixBlendModeToFigmaBlendMode(
  mixBlendMode: string | undefined | null
): FigmaNodeBlendMode | null {
  if (!mixBlendMode) {
    return null;
  }
  return MIX_BLEND_MODES[mixBlendMode.trim().toLowerCase()] ?? null;
}
