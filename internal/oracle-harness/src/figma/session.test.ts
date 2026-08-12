import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  classifyStorageState,
  fileUrl,
  isAnonymousViewer,
  resolveSessionConfig,
} from "./session";

const STATE_JSON = '{"cookies":[],"origins":[]}';

describe("classifyStorageState()", () => {
  it("treats a filesystem path as a path", () => {
    expect(classifyStorageState(".figma-storage-state.json")).toEqual({
      kind: "path",
      path: ".figma-storage-state.json",
    });
  });

  it("parses inline JSON", () => {
    const result = classifyStorageState(STATE_JSON);
    expect(result).toEqual({
      kind: "inline",
      state: { cookies: [], origins: [] },
    });
  });

  it("decodes base64-of-JSON (CI secret form)", () => {
    const b64 = Buffer.from(STATE_JSON, "utf-8").toString("base64");
    const result = classifyStorageState(b64);
    expect(result).toEqual({
      kind: "inline",
      state: { cookies: [], origins: [] },
    });
  });

  it("reports malformed inline JSON", () => {
    expect(classifyStorageState("{ not json")).toEqual({
      error: expect.stringContaining("did not parse"),
    });
  });
});

describe("resolveSessionConfig()", () => {
  it("resolves when the required vars are present", () => {
    const result = resolveSessionConfig({
      FIGMA_STORAGE_STATE: ".figma-storage-state.json",
      FIGMA_FILE_KEY: "abc123",
    });
    expect(result).toEqual({
      ok: true,
      config: {
        storageState: { kind: "path", path: ".figma-storage-state.json" },
        fileKey: "abc123",
        token: undefined,
      },
    });
  });

  it("carries the optional token when set", () => {
    const result = resolveSessionConfig({
      FIGMA_STORAGE_STATE: ".s.json",
      FIGMA_FILE_KEY: "k",
      FIGMA_TOKEN: "tok",
    });
    expect(result.ok && result.config.token).toBe("tok");
  });

  it("collects a checklist of every missing required var", () => {
    const result = resolveSessionConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors.join("\n")).toContain("FIGMA_STORAGE_STATE");
      expect(result.errors.join("\n")).toContain("FIGMA_FILE_KEY");
    }
  });

  it("does not require the token", () => {
    const result = resolveSessionConfig({
      FIGMA_STORAGE_STATE: ".s.json",
      FIGMA_FILE_KEY: "k",
    });
    expect(result.ok).toBe(true);
  });
});

describe("fileUrl()", () => {
  it("builds a /design/ url from the file key", () => {
    expect(fileUrl("abc123")).toBe("https://www.figma.com/design/abc123");
  });
});

describe("isAnonymousViewer()", () => {
  // Text sampled from a real expired-session run: the file still rendered a
  // canvas, which is why the old canvas-only check passed.
  it("detects the signed-out sign-up banner", () => {
    expect(
      isAnonymousViewer(
        "proj Share View only Sign up to comment, edit, inspect and more. Sign up"
      )
    ).toBe(true);
  });

  it("detects a bare view-only badge", () => {
    expect(isAnonymousViewer("proj\nView only\n100%")).toBe(true);
  });

  it("accepts editor chrome", () => {
    expect(
      isAnonymousViewer("Layers Assets Design Prototype Page 1 100%")
    ).toBe(false);
  });

  it("does not fire on unrelated text containing the words", () => {
    expect(isAnonymousViewer("Overview onlyfans reviewer")).toBe(false);
  });

  it("treats empty text as not-anonymous so a scrape failure is not a false alarm", () => {
    expect(isAnonymousViewer("")).toBe(false);
  });
});
