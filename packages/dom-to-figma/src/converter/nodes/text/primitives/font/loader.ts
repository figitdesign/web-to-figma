import type { Font } from "fontkit";
import { create } from "fontkit";
import type { OpenTypeFont } from "../../types";
import type { FontMetrics } from "./metrics";
import { extractFontMetrics } from "./metrics";

/**
 * Font properties used to request a font file. The loader is free to apply
 * fallbacks (closest available weight, drop italic when not available, etc.)
 * and reports the resolved values back via `FontFile`.
 */
export type FontProperties = {
  family: string;
  weight: number;
  italic: boolean;
};

/**
 * Result of loading a font file. `bytes` is the raw font file (TTF, OTF,
 * WOFF, or WOFF2 — fontkit detects the format). The optional `resolved*`
 * fields let the loader signal that a fallback was applied.
 */
export type FontFile = {
  bytes: ArrayBuffer;
  resolvedWeight?: number;
  resolvedItalic?: boolean;
};

/**
 * A function that resolves font properties to a font file. The loader owns
 * any catalog or fallback logic; the converter only consumes the bytes.
 */
export type FontLoader = (request: FontProperties) => Promise<FontFile>;

export type LoadedFont = {
  font: OpenTypeFont;
  metrics: FontMetrics;
  /** What was requested. */
  properties: FontProperties;
  /** What was actually loaded (after the loader's fallbacks). */
  actualWeight?: number;
  actualItalic: boolean;
  fontStyleName: string;
  postScriptName: string;
};

const WEIGHT_TO_STYLE_NAME: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export async function loadFont(
  fontLoader: FontLoader,
  properties: FontProperties
): Promise<LoadedFont> {
  const file = await fontLoader(properties);

  // fontkit's `create` accepts any `Uint8Array`-backed buffer at runtime; the
  // `Buffer` parameter type in the published `.d.ts` is misleading. Browser-safe.
  const parsed = create(new Uint8Array(file.bytes) as unknown as Buffer);
  if (!isFont(parsed)) {
    throw new Error(
      "fontkit returned a font collection; collection inputs are not supported"
    );
  }
  const font = parsed;
  const metrics = extractFontMetrics(font);

  const actualWeight = file.resolvedWeight ?? properties.weight;
  const actualItalic = file.resolvedItalic ?? properties.italic;
  const fontStyleName = buildFontStyleName(actualWeight, actualItalic);
  const postScriptName =
    font.postscriptName ??
    `${properties.family.replace(/\s+/g, "")}-${fontStyleName.replace(/\s+/g, "")}`;

  return {
    font,
    metrics,
    properties,
    actualWeight,
    actualItalic,
    fontStyleName,
    postScriptName,
  };
}

/**
 * fontkit's `create` returns either a `Font` or a `FontCollection` (TTC/DFont).
 * We discriminate on the `type` field — collections expose `'TTC' | 'DFont'`,
 * everything else is a single font.
 */
function isFont(value: unknown): value is Font {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  return type !== "TTC" && type !== "DFont";
}

function buildFontStyleName(weight: number, italic: boolean): string {
  const baseName = WEIGHT_TO_STYLE_NAME[weight] ?? "Regular";
  if (!italic) {
    return baseName;
  }
  if (baseName === "Regular") {
    return "Italic";
  }
  return `${baseName} Italic`;
}

/**
 * Options for the default fontsource-backed loader.
 */
export type FontsourceLoaderOptions = {
  /** Subset to request. Defaults to "latin". Common alternatives: "latin-ext", "cyrillic", "greek". */
  subset?: string;
};

const FONTSOURCE_BASE_URL = "https://cdn.jsdelivr.net/fontsource/fonts";
const FONTSOURCE_VERSION = "5";
const FONTSOURCE_FALLBACK_WEIGHT = 400;
const FONTSOURCE_DEFAULT_SUBSET = "latin";

/**
 * Build a `FontLoader` that pulls Google Fonts as static `.woff2` files from
 * fontsource via jsDelivr's CDN. No API key, no UA tricks, browser-friendly.
 * fontkit decompresses WOFF2 transparently.
 *
 * Falls back through a small chain when the exact (weight, italic) combo
 * isn't available: drop italic, then regular 400, then throw.
 */
export function createFontsourceLoader(
  options: FontsourceLoaderOptions = {}
): FontLoader {
  const subset = options.subset ?? FONTSOURCE_DEFAULT_SUBSET;

  return async (request: FontProperties): Promise<FontFile> => {
    for (const candidate of buildFallbackChain(request)) {
      const url = buildFontsourceUrl(candidate, subset);
      const bytes = await tryFetchFont(url);
      if (bytes) {
        return {
          bytes,
          resolvedWeight: candidate.weight,
          resolvedItalic: candidate.italic,
        };
      }
    }

    throw new Error(
      `fontsource: no variant found for ${formatRequest(request)} (subset=${subset})`
    );
  };
}

function buildFallbackChain(request: FontProperties): Array<FontProperties> {
  const chain: Array<FontProperties> = [request];
  if (request.italic) {
    chain.push({ ...request, italic: false });
  }
  if (request.weight !== FONTSOURCE_FALLBACK_WEIGHT) {
    chain.push({
      ...request,
      weight: FONTSOURCE_FALLBACK_WEIGHT,
      italic: false,
    });
  }
  return chain;
}

function buildFontsourceUrl(props: FontProperties, subset: string): string {
  const slug = familyToSlug(props.family);
  const style = props.italic ? "italic" : "normal";
  return `${FONTSOURCE_BASE_URL}/${slug}@${FONTSOURCE_VERSION}/${subset}-${props.weight}-${style}.woff2`;
}

function familyToSlug(family: string): string {
  return family.replace(/['"]/g, "").trim().toLowerCase().replace(/\s+/g, "-");
}

async function tryFetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

function formatRequest(request: FontProperties): string {
  return `${request.family} ${request.weight} ${request.italic ? "italic" : "normal"}`;
}
