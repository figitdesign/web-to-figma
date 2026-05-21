import { describe, expect, it } from "vitest";
import { composeClipboardHtml } from "./clipboard";

const BASE64_PAYLOAD = "ZmlnLWtpd2k=";

describe("composeClipboardHtml", () => {
  it("stores Figma markers inside data attributes so WebKit HTML sanitization preserves them", () => {
    const html = composeClipboardHtml(BASE64_PAYLOAD);

    expect(html).toContain('data-metadata="<!--(figmeta)');
    expect(html).toContain('data-buffer="<!--(figma)ZmlnLWtpd2k=(/figma)-->"');
    expect(html.startsWith("<!--(figmeta)")).toBe(false);
  });
});
