import type { FigmaBlurEffect, FigmaEffect } from "../types/effects";
import { cssShadowListToDropShadows } from "./shadow";

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

  const effects: Array<FigmaEffect> = [];

  // Match blur() functions in the filter
  const blurMatches = filter.match(/blur\(([^)]+)\)/g);

  if (blurMatches) {
    for (const blurMatch of blurMatches) {
      const blurValueMatch = /blur\(([^)]+)\)/.exec(blurMatch);
      if (blurValueMatch?.[1]) {
        const blurValueStr = blurValueMatch[1];
        // Parse value and remove 'px' unit if present
        const blurValue = Number.parseFloat(blurValueStr);

        if (!Number.isNaN(blurValue) && blurValue > 0) {
          const effect: FigmaBlurEffect = {
            type: "FOREGROUND_BLUR",
            visible: true,
            radius: blurValue,
          };
          effects.push(effect);
        }
      }
    }
  }

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

  const effects: Array<FigmaBlurEffect> = [];

  // Match blur() functions in the backdrop-filter
  const blurMatches = backdropFilter.match(/blur\(([^)]+)\)/g);

  if (blurMatches) {
    for (const blurMatch of blurMatches) {
      const blurValueMatch = /blur\(([^)]+)\)/.exec(blurMatch);
      if (blurValueMatch?.[1]) {
        const blurValueStr = blurValueMatch[1];
        // Parse value and remove 'px' unit if present
        const blurValue = Number.parseFloat(blurValueStr);

        if (!Number.isNaN(blurValue) && blurValue > 0) {
          const effect: FigmaBlurEffect = {
            type: "BACKGROUND_BLUR",
            visible: true,
            radius: blurValue,
          };
          effects.push(effect);
        }
      }
    }
  }

  return effects;
}
