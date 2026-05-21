# @figit/fig-kiwi

Encode Figma's Kiwi binary format and HTML clipboard envelope.

```ts
import { encodeFigmaData, composeClipboardHtml } from "@figit/fig-kiwi";

const { figBytes, base64 } = encodeFigmaData(message);
const html = composeClipboardHtml(base64, { dataType: "scene", fileKey: "TEST", pasteID: 123 });
```

## API

- `encodeFigmaData(message)` — encode a Kiwi `Message` into fig-kiwi bytes (magic + version + deflated schema + deflated data) plus base64.
- `composeClipboardHtml(base64, meta?)` — wrap the base64 payload in the HTML envelope Figma reads on paste, using Figma-style `data-metadata` and `data-buffer` attributes so WebKit preserves the markers during HTML clipboard sanitization. Works in any environment with `btoa` (no DOM).
- `toClipboardItem(html)` — browser/extension helper that wraps the HTML in a `ClipboardItem` for `navigator.clipboard.write`.
- `KiwiWriter` — varint write primitives (byte, bool, uint, int, float, string, …) for callers that need to emit other Kiwi structures.
- `SCHEMA` — the bundled Figma Kiwi schema.

## Regenerating the schema

`src/schema.json` is generated. To pull a fresh copy from Figma:

```sh
# In Figma: select any node, Cmd+C
pnpm extract-schema
```

The script reads the system clipboard's `text/html`, decodes the embedded Kiwi schema, and overwrites `src/schema.json`. macOS and Linux clipboard reads work automatically; on Windows, pipe HTML on stdin or pass a file path:

```sh
pnpm extract-schema clipboard.html       # from a file
cat clipboard.html | pnpm extract-schema -   # from stdin
```

## License

[MIT](./LICENSE) — Figit.
