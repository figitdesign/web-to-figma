import type { FontLoader, FontProperties } from "@sleekdesign/dom-to-figma";

/**
 * Wraps a `FontLoader` with a page-aware first try: when dom-to-figma asks
 * for a font, we look at the page's own `@font-face` rules. If one matches
 * the request and points at a format opentype.js (1.x) can parse — TTF,
 * OTF, WOFF, EOT — we fetch that URL (the browser's HTTP cache hits for
 * free since the page already loaded it) and use the actual page bytes.
 *
 * WOFF2 entries are skipped because opentype.js 1.x doesn't include a
 * brotli decoder. Most modern pages serve WOFF2 exclusively, so this layer
 * mostly helps for: sites that ship multi-format `@font-face` with TTF /
 * WOFF fallbacks for older browsers, custom corporate fonts served as
 * TTF, and font CDNs other than Google Fonts that still ship TTF.
 *
 * Cross-origin stylesheets that block `cssRules` access are silently
 * skipped — we never see those `@font-face` declarations and fall back
 * for fonts only declared there. JS-constructed `FontFace` instances are
 * also missed (the spec doesn't expose the bytes back).
 */

const FALLBACK_WEIGHT = 400;

const PARSEABLE_FORMATS = new Set([
  "truetype",
  "opentype",
  "woff",
  "embedded-opentype",
]);

const FONT_URL_PATTERN =
  /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)(?:\s+format\(\s*['"]?([^'"\s)]+)['"]?\s*\))?/g;

const PARSEABLE_EXTENSION = /\.(ttf|otf|woff|eot)(\?|#|$)/i;

const KEYWORD_TO_WEIGHT: Record<string, number> = {
  normal: 400,
  bold: 700,
  lighter: 300,
  bolder: 700,
};

type PageFontEntry = {
  family: string;
  weightMin: number;
  weightMax: number;
  italic: boolean;
  url: string;
};

export type CreatePageFontLoaderOptions = {
  fallbackLoader: FontLoader;
};

export function createPageFontLoader({
  fallbackLoader,
}: CreatePageFontLoaderOptions): FontLoader {
  let entries: ReadonlyArray<PageFontEntry> | null = null;

  return async (request: FontProperties) => {
    if (entries === null) {
      entries = collectPageFontFaces();
    }

    const match = findBestMatch(entries, request);
    if (!match) {
      return fallbackLoader(request);
    }

    try {
      const bytes = await fetchFontBytes(match.url);
      return {
        bytes,
        resolvedWeight: clamp(request.weight, match.weightMin, match.weightMax),
        resolvedItalic: match.italic,
      };
    } catch {
      return fallbackLoader(request);
    }
  };
}

function collectPageFontFaces(): Array<PageFontEntry> {
  const collected: Array<PageFontEntry> = [];
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet — `cssRules` access throws SecurityError.
      continue;
    }
    if (!rules) {
      continue;
    }
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        const entry = parseFontFaceRule(rule);
        if (entry) {
          collected.push(entry);
        }
      }
    }
  }
  return collected;
}

function parseFontFaceRule(rule: CSSFontFaceRule): PageFontEntry | null {
  const style = rule.style;
  const family = unquote(style.getPropertyValue("font-family"));
  const src = style.getPropertyValue("src");
  if (!(family && src)) {
    return null;
  }

  const url = pickParseableUrl(src);
  if (!url) {
    return null;
  }

  const fontStyle = style.getPropertyValue("font-style") || "normal";
  const fontWeight = style.getPropertyValue("font-weight") || "400";
  const [weightMin, weightMax] = parseWeightRange(fontWeight);
  const italic = fontStyle === "italic" || fontStyle === "oblique";

  return { family, weightMin, weightMax, italic, url };
}

/**
 * Walk the comma-separated `src` list and return the first source whose
 * format we can confidently parse. Sources with a non-parseable format
 * hint (`woff2`, `svg`) are skipped; sources without any hint and without
 * a recognizable extension are skipped too — we only commit to URLs we
 * believe opentype.js will accept.
 */
function pickParseableUrl(src: string): string | null {
  for (const source of parseSources(src)) {
    const format = source.format?.toLowerCase();
    if (format) {
      if (PARSEABLE_FORMATS.has(format)) {
        return source.url;
      }
      continue;
    }
    if (PARSEABLE_EXTENSION.test(source.url)) {
      return source.url;
    }
  }
  return null;
}

function parseSources(src: string): Array<{ url: string; format?: string }> {
  const sources: Array<{ url: string; format?: string }> = [];
  // RegExp.exec mutation needs a stateful regex; clone to avoid sharing.
  const pattern = new RegExp(FONT_URL_PATTERN.source, FONT_URL_PATTERN.flags);
  let match: RegExpExecArray | null = pattern.exec(src);
  while (match !== null) {
    sources.push({ url: match[1], format: match[2] });
    match = pattern.exec(src);
  }
  return sources;
}

function parseWeightRange(weight: string): [number, number] {
  const numbers: Array<number> = [];
  for (const token of weight.trim().split(/\s+/)) {
    const value = weightTokenToNumber(token);
    if (value !== null) {
      numbers.push(value);
    }
  }
  if (numbers.length === 0) {
    return [FALLBACK_WEIGHT, FALLBACK_WEIGHT];
  }
  if (numbers.length === 1) {
    return [numbers[0], numbers[0]];
  }
  return [numbers[0], numbers[1]];
}

function weightTokenToNumber(token: string): number | null {
  const keyword = KEYWORD_TO_WEIGHT[token.toLowerCase()];
  if (keyword !== undefined) {
    return keyword;
  }
  const parsed = Number.parseInt(token, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function findBestMatch(
  entries: ReadonlyArray<PageFontEntry>,
  request: FontProperties
): PageFontEntry | null {
  const familyKey = request.family.toLowerCase();

  // Exact: same family + italic, requested weight inside the entry's range.
  const exact = entries.find(
    (entry) =>
      entry.family.toLowerCase() === familyKey &&
      entry.italic === request.italic &&
      request.weight >= entry.weightMin &&
      request.weight <= entry.weightMax
  );
  if (exact) {
    return exact;
  }

  // Same family + italic, closest weight range.
  const sameItalic = entries
    .filter(
      (entry) =>
        entry.family.toLowerCase() === familyKey &&
        entry.italic === request.italic
    )
    .sort(
      (a, b) =>
        weightDistance(a, request.weight) - weightDistance(b, request.weight)
    );
  if (sameItalic.length > 0) {
    return sameItalic[0];
  }

  // Same family, accept any italic — last resort before falling back.
  return (
    entries.find((entry) => entry.family.toLowerCase() === familyKey) ?? null
  );
}

function weightDistance(entry: PageFontEntry, weight: number): number {
  if (weight >= entry.weightMin && weight <= entry.weightMax) {
    return 0;
  }
  return weight < entry.weightMin
    ? entry.weightMin - weight
    : weight - entry.weightMax;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Font fetch failed (${response.status}) for ${url}`);
  }
  return response.arrayBuffer();
}
