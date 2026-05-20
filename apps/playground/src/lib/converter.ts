import { createFigmaConverter } from "@figit/dom-to-figma";

// One converter instance per page so the in-memory font/image caches stay warm
// across re-runs while the user iterates on a scene.
let cached: ReturnType<typeof createFigmaConverter> | null = null;

export function getConverter() {
  if (!cached) {
    cached = createFigmaConverter();
  }
  return cached;
}
