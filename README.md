<p align="center">
  <img src="./assets/figit-logotype.png" alt="Figit" width="240" />
</p>

Convert HTML to editable Figma layers. No plugin needed, just paste.

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

Paste in Figma with **Cmd+V** / **Ctrl+V**. Done.

## What it does

Walks a real DOM tree, reads computed styles, and produces what Figma reads on paste. Text becomes editable text; images, vectors, gradients, shadows, borders, and form placeholders all carry over. Layouts arrive as **native Figma auto-layout** by default — flex, block flow, wrap, and grid become real stacks, with per-container fallback to absolute positioning when a layout can't be reproduced exactly. Opt out with `createFigmaConverter({ layout: "absolute" })`.

Used in production by [Sleek](https://sleek.design) to copy generated designs straight from the browser into Figma.

## Packages

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@figit/dom-to-figma`](./packages/dom-to-figma) | [![npm](https://img.shields.io/npm/v/@figit/dom-to-figma)](https://www.npmjs.com/package/@figit/dom-to-figma) | Convert any DOM tree to a Figma clipboard payload. |

See the [`dom-to-figma` README](./packages/dom-to-figma) for the full API: customizing font/image loaders, multi-frame canvases, and DOM-to-node classification.

## Install

```sh
pnpm add @figit/dom-to-figma
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — Figit.

Not affiliated with or endorsed by Figma.
