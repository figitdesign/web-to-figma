# @figit/dom-to-figma

Convert any DOM tree to a Figma clipboard payload, in the browser.

```ts
import { createFigmaConverter } from "@figit/dom-to-figma";

const figma = createFigmaConverter();

const result = await figma.convert({
  element: document.getElementById("design"),
  width: 1280,
  height: 800,
  name: "Hero",
});

await navigator.clipboard.write([result.toClipboardItem()]);
```

Paste in Figma. Done.

## Install

```sh
pnpm add @figit/dom-to-figma
```

## What it does

Walks a real DOM tree, reads computed styles, and produces what Figma reads on paste. Text becomes editable text; images, vectors, gradients, shadows, borders, and form placeholders all carry over.

Used in production by Sleek to copy designs straight from the browser into Figma.

## Layout

By default the converter infers **native Figma auto-layout**: flex containers, plain block flow, wrapping rows, and grids become real stacks (`stackMode`, spacing, padding, hug/fill/stretch sizing), and absolutely positioned children ride along as absolute-positioned layers. Inference is per-container and verified against the browser's measured geometry — any container it can't reproduce exactly falls back to absolute positioning, so the result is never worse than a fixed-position paste.

```ts
const figma = createFigmaConverter(); // layout: "auto" (default)
```

Pass `layout: "absolute"` to disable inference and position every frame absolutely (the pre-1.0 behavior):

```ts
const figma = createFigmaConverter({ layout: "absolute" });
```

## Multi-frame canvas

Pass `frames` instead of a single `element` to copy several DOM trees onto one Figma canvas:

```ts
const result = await figma.convert({
  frames: [
    { element: a, width: 800, height: 600, x: 0,   y: 0, name: "Hero" },
    { element: b, width: 800, height: 600, x: 900, y: 0, name: "Pricing" },
  ],
  canvasName: "Landing",
});

await navigator.clipboard.write([result.toClipboardItem()]);
```

## Result shape

```ts
type ConvertResult = {
  document: FigmaClipboard;          // raw node-change document
  bytes: Uint8Array;                 // encoded .fig-style binary
  base64: string;                    // base64 of bytes
  toClipboardItem(): ClipboardItem;  // ready for navigator.clipboard.write
  toClipboardHtml(): string;         // raw HTML envelope Figma reads on paste
};
```

## Customizing loaders

The converter takes three optional hooks:

```ts
const figma = createFigmaConverter({
  fontLoader,   // (props) => Promise<FontFile>
  imageLoader,  // (req) => Promise<ImageFile>
  classify,     // (element, defaultKind) => ElementKind
});
```

Repeated `convert()` calls on the same converter reuse cached fonts and images. Call `figma.clearCache()` to drop them.

### Fonts

Default: `createFontsourceLoader()` pulls fonts from fontsource via jsDelivr's CDN. Covers all Google Fonts plus other open-source families. No API key required.

```ts
import { createFontsourceLoader } from "@figit/dom-to-figma";

const figma = createFigmaConverter({
  fontLoader: createFontsourceLoader({ subset: "latin-ext" }),
});
```

For non-fontsource fonts, write your own loader:

```ts
import type { FontLoader } from "@figit/dom-to-figma";

const myFontLoader: FontLoader = async ({ family, weight, italic }) => {
  const url = await myFontCDN(family, weight, italic);
  const response = await fetch(url);
  return { bytes: await response.arrayBuffer() };
};
```

### Images

Default: `createDirectImageLoader()` does a direct `fetch(src)`. Cross-origin images without CORS need a custom loader, typically a proxy chain:

```ts
import type { ImageLoader } from "@figit/dom-to-figma";

const myImageLoader: ImageLoader = async ({ src }) => {
  const url = `https://my-proxy.example/?url=${encodeURIComponent(src)}`;
  const response = await fetch(url);
  const blob = await response.blob();
  return {
    bytes: await blob.arrayBuffer(),
    mimeType: blob.type,
  };
};
```

The package re-encodes WebP/AVIF/etc. to PNG internally, so the loader only needs to return raw bytes and a mime type.

### Classification

`classify` lets you override how DOM elements map to Figma node kinds. The default classifier returns `text`, `image`, `vector`, `frame`, `group`, `form-with-placeholder`, or `skip`:

```ts
import type { Classify } from "@figit/dom-to-figma";

const classify: Classify = (element, defaultKind) => {
  if (element.dataset.role === "text-wrapper") {
    return "text";
  }
  return defaultKind;
};
```

## Runtime requirements

Runs in any modern browser. Depends on `window.getComputedStyle`, `Blob`, `ClipboardItem`, `document.createElement`, `crypto.subtle.digest`, `Image`, and `<canvas>`.

## Disclaimer

Not affiliated with or endorsed by Figma.
