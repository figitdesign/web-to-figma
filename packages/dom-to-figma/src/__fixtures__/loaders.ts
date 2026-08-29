import type { FontFile, FontLoader } from "../figma";
import interLatin400Url from "./fonts/inter-latin-400.ttf?url";
import openSansLatin400Url from "./fonts/open-sans-latin-400.ttf?url";

export const TEST_FONT_FAMILY = "Open Sans";
export const ALT_TEST_FONT_FAMILY = "Inter";

export function createTestFontLoader(): FontLoader {
  return buildFixtureLoader(openSansLatin400Url, "Open Sans");
}

export function createInterFontLoader(): FontLoader {
  return buildFixtureLoader(interLatin400Url, "Inter");
}

function buildFixtureLoader(url: string, label: string): FontLoader {
  return async (request): Promise<FontFile> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${label} fixture: ${response.status}`);
    }
    return {
      bytes: await response.arrayBuffer(),
      resolvedWeight: request.weight,
      resolvedItalic: request.italic,
    };
  };
}

/**
 * Register a bundled TTF as `@font-face` and wait for the browser to load it.
 * Tests rely on this so `getBoundingClientRect` measures real metrics rather
 * than falling back to a system serif.
 */
export async function loadTestFontIntoBrowser(): Promise<void> {
  await registerFontFace(TEST_FONT_FAMILY, openSansLatin400Url);
}

export async function loadInterIntoBrowser(): Promise<void> {
  await registerFontFace(ALT_TEST_FONT_FAMILY, interLatin400Url);
}

async function registerFontFace(family: string, url: string): Promise<void> {
  const fontFace = new FontFace(family, `url(${url}) format("truetype")`, {
    weight: "400",
    style: "normal",
  });
  await fontFace.load();
  document.fonts.add(fontFace);
  await document.fonts.ready;
}

/** Inline 1x1 red PNG (69 bytes). The default ImageLoader's fetch handles data URLs. */
export const TINY_RED_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/**
 * Inline 8x8 PNG split into four solid quadrants. Multi-pixel and multi-colour,
 * so tests can tell resampled bytes apart from the original.
 */
export const QUAD_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAN0lEQVR4AWN8amn6nwEJWPpvYEAGTAwEABMDAcDEQACwSMxnQAGqJ5IYkAETAwHAxEAAMDEQAACGegWiVgjoJQAAAABJRU5ErkJggg==";
