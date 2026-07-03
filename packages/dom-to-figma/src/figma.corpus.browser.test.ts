/**
 * Corpus sweep: every playground scene must convert with `layout: "auto"`
 * without throwing, and layout-heavy pages must actually produce stacks.
 * Inference self-verifies geometry per container (falling back to NONE), so
 * "it converted and made stacks" is the meaningful smoke signal here; the
 * exact per-field expectations live in the oracle fixture tests.
 */

import { describe, expect, it } from "vitest";
import cardHtml from "../../../apps/playground/src/corpus/integrations/card.html?raw";
import formHtml from "../../../apps/playground/src/corpus/integrations/form.html?raw";
import heroHtml from "../../../apps/playground/src/corpus/integrations/hero.html?raw";
import landingHtml from "../../../apps/playground/src/corpus/integrations/landing.html?raw";
import flexHtml from "../../../apps/playground/src/corpus/layout/flex.html?raw";
import gridHtml from "../../../apps/playground/src/corpus/layout/grid.html?raw";
import {
  createTestFontLoader,
  loadTestFontIntoBrowser,
} from "./__fixtures__/loaders";
import type { FigmaFrameNodeChange } from "./converter/types";
import { createFigmaConverter } from "./figma";

const CORPUS: Array<{ name: string; html: string; minStacks: number }> = [
  { name: "layout/flex", html: flexHtml, minStacks: 5 },
  { name: "layout/grid", html: gridHtml, minStacks: 1 },
  { name: "integrations/card", html: cardHtml, minStacks: 1 },
  { name: "integrations/form", html: formHtml, minStacks: 1 },
  { name: "integrations/hero", html: heroHtml, minStacks: 1 },
  { name: "integrations/landing", html: landingHtml, minStacks: 1 },
];

describe("corpus sweep with layout: auto", () => {
  for (const scene of CORPUS) {
    it(`converts ${scene.name} and produces auto-layout stacks`, async () => {
      await loadTestFontIntoBrowser();
      const wrapper = document.createElement("div");
      wrapper.style.width = "1280px";
      wrapper.innerHTML = scene.html;
      document.body.appendChild(wrapper);

      try {
        const figma = createFigmaConverter({
          layout: "auto",
          fontLoader: createTestFontLoader(),
        });
        const result = await figma.convert({
          element: wrapper,
          width: 1280,
          height: 800,
          name: scene.name,
        });

        const changes = result.document.nodeChanges;
        expect(changes.length).toBeGreaterThan(5);
        const stacks = changes.filter((change) => {
          const mode = (change as FigmaFrameNodeChange).stackMode;
          return mode === "HORIZONTAL" || mode === "VERTICAL";
        });
        expect(stacks.length).toBeGreaterThanOrEqual(scene.minStacks);
      } finally {
        wrapper.remove();
      }
    });
  }
});
