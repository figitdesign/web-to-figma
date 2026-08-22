import type { FigmaBlurEffect, FigmaEffect } from "../types/effects";
import { cssShadowListToDropShadows } from "./shadow";

/**
 * CSS `blur(<length>)` is a Gaussian whose *standard deviation* is the length;
 * Figma's blur `radius` is twice that sigma. Passing the CSS length straight
 * through renders half as soft as the browser — measured on
 * `fx/fx-07-filter-blur`, whose 10–90% edge falloff was 14px in Chrome and 7px
 * in Figma for the same `blur(6px)`.
 */
const FIGMA_BLUR_RADIUS_PER_CSS_SIGMA = 2;

/** Every top-level `blur()` length in a filter value, as Figma blur effects. */
function extractBlurEffects(
  value: string,
  type: FigmaBlurEffect["type"]
): Array<FigmaBlurEffect> {
  const effects: Array<FigmaBlurEffect> = [];
  for (const match of value.matchAll(/blur\(([^)]+)\)/g)) {
    const sigma = Number.parseFloat(match[1] ?? "");
    if (Number.isNaN(sigma) || sigma <= 0) {
      continue;
    }
    effects.push({
      type,
      visible: true,
      radius: sigma * FIGMA_BLUR_RADIUS_PER_CSS_SIGMA,
    });
  }
  return effects;
}

/**
 * Extract the argument of each top-level `drop-shadow(...)` in a CSS filter,
 * scanning paren depth so nested color functions (`rgba(...)`, `hsl(...)`) do
 * not terminate the match early the way a naive regex would.
 *
 * @param filter - The CSS filter value to scan.
 * @returns The raw argument string of each `drop-shadow()`, in source order.
 */
function extractDropShadowArgs(filter: string): Array<string> {
  const token = "drop-shadow(";
  const args: Array<string> = [];
  let start = filter.indexOf(token);
  while (start !== -1) {
    let depth = 1;
    let i = start + token.length;
    for (; i < filter.length && depth > 0; i += 1) {
      if (filter[i] === "(") {
        depth += 1;
      } else if (filter[i] === ")") {
        depth -= 1;
      }
    }
    args.push(filter.slice(start + token.length, i - 1).trim());
    start = filter.indexOf(token, i);
  }
  return args;
}

/**
 * Parse the CSS `filter` property into Figma effects: `blur()` becomes a
 * FOREGROUND_BLUR and each `drop-shadow()` becomes a DROP_SHADOW. Other filter
 * functions (color-matrix `grayscale`/`brightness`/`contrast`, etc.) have no
 * Figma effect equivalent and are ignored.
 *
 * @param filter - The CSS filter value to parse.
 * @returns An array of Figma effects.
 */
export function cssFilterToFigmaEffects(filter: string): Array<FigmaEffect> {
  if (!filter || filter === "none") {
    return [];
  }

  const effects: Array<FigmaEffect> = [
    ...extractBlurEffects(filter, "FOREGROUND_BLUR"),
  ];

  // Each drop-shadow() maps to a DROP_SHADOW — same grammar as a single
  // text-shadow (offset + blur + color, no inset or spread).
  for (const arg of extractDropShadowArgs(filter)) {
    effects.push(...cssShadowListToDropShadows(arg));
  }

  return effects;
}

/**
 * Parse CSS backdrop-filter property and convert blur effects to Figma effects
 * @param backdropFilter - The CSS backdrop-filter value to parse.
 * @returns An array of Figma effects.
 */
export function cssBackdropFilterToFigmaEffects(
  backdropFilter: string
): Array<FigmaBlurEffect> {
  if (!backdropFilter || backdropFilter === "none") {
    return [];
  }

  return extractBlurEffects(backdropFilter, "BACKGROUND_BLUR");
}
