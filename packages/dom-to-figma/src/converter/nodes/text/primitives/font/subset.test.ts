import { describe, expect, it } from "vitest";
import { detectFontSubset } from "./subset";

describe("detectFontSubset()", () => {
  it("keeps plain ASCII on the default latin subset", () => {
    expect(detectFontSubset("Hello world")).toBe("latin");
  });

  it("picks cyrillic for Cyrillic text", () => {
    expect(detectFontSubset("Привет")).toBe("cyrillic");
  });

  it("picks greek for Greek text", () => {
    expect(detectFontSubset("Γειά σου")).toBe("greek");
  });

  it("picks latin-ext for Latin Extended-A characters", () => {
    expect(detectFontSubset("Łódź")).toBe("latin-ext");
  });

  it("prefers vietnamese over latin-ext for the ranges they share", () => {
    expect(detectFontSubset("Tiếng Việt")).toBe("vietnamese");
  });

  it("falls back to latin for scripts fontsource does not split out", () => {
    expect(detectFontSubset("🎉 ✅ 🚀")).toBe("latin");
  });

  it("lets the majority script win a mixed run", () => {
    expect(detectFontSubset("ok Привет")).toBe("cyrillic");
  });

  it("treats accented latin-1 as latin", () => {
    expect(detectFontSubset("Ünïcødé ß æ")).toBe("latin");
  });
});
