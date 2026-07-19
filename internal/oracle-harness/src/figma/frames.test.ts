import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTopFrameNames } from "./frames";

// A real converter payload for 00-smoke/two-boxes (what we paste into Figma).
const SENT = readFileSync(
  resolve(import.meta.dirname, "__fixtures__/two-boxes.sent.html"),
  "utf-8"
);

describe("extractTopFrameNames()", () => {
  it("decodes a payload and returns its top-level frame names", () => {
    expect(extractTopFrameNames(SENT)).toEqual(["Two Boxes"]);
  });

  it("returns [] for html without a figma buffer", () => {
    expect(extractTopFrameNames("<div>not a payload</div>")).toEqual([]);
  });
});
