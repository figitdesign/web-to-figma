import { describe, expect, it } from "vitest";
import { discoverScenes } from "./scenes";

describe("discoverScenes()", () => {
  const scenes = discoverScenes();

  it("finds the committed oracle scenes", () => {
    expect(scenes.length).toBeGreaterThan(0);
  });

  it("derives batch/name ids without an extension", () => {
    for (const scene of scenes) {
      expect(scene.id.endsWith(".html")).toBe(false);
    }
    // At least one scene lives under a batch directory (e.g. `01-flex/...`).
    expect(scenes.some((scene) => scene.id.includes("/"))).toBe(true);
  });

  it("gives every scene a positive size", () => {
    for (const scene of scenes) {
      expect(scene.width).toBeGreaterThan(0);
      expect(scene.height).toBeGreaterThan(0);
    }
  });

  it("produces a stable id/size manifest", () => {
    const manifest = scenes.map((scene) => ({
      id: scene.id,
      width: scene.width,
      height: scene.height,
    }));
    expect(manifest).toMatchSnapshot();
  });
});
