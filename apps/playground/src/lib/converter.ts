import type { ConverterLayout } from "@figit/dom-to-figma";
import { createFigmaConverter } from "@figit/dom-to-figma";

// One converter instance per layout mode so the in-memory font/image caches
// stay warm across re-runs while the user iterates on a scene and toggles
// between absolute positioning and inferred auto-layout.
const cache = new Map<
  ConverterLayout,
  ReturnType<typeof createFigmaConverter>
>();

export function getConverter(layout: ConverterLayout = "absolute") {
  let converter = cache.get(layout);
  if (!converter) {
    converter = createFigmaConverter({ layout });
    cache.set(layout, converter);
  }
  return converter;
}
