import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import {
  cleanCanvas,
  copyPng,
  pastePayload,
  waitForSettlement,
} from "./figma/paste";
import type { RunDir } from "./run-dir";
import type { Scene } from "./scenes";
import { decodePng, diffImages } from "./tier2/pixel";

// Recommended noise floor as a margin over the observed render noise. Figma's
// render is deterministic, so render noise should be ~0 and the real floor is
// the inherent Chrome-vs-Figma AA (~0.02% on the noisiest clean scene).
const FLOOR_MARGIN = 5;
const OBSERVED_AA_FLOOR = 0.0002;

export type Calibration = {
  /** Per-scene Figma-vs-Figma render noise (paste the same payload twice). */
  figmaRenderNoise: Record<string, number>;
  maxRenderNoise: number;
  /** Sub-this diff ratio is treated as sub-pixel noise, not a finding. */
  recommendedNoiseFloor: number;
};

/** Recommend a noise floor from measured render noise and the observed
 * cross-renderer AA floor. Pure. */
export function recommendNoiseFloor(
  renderNoises: ReadonlyArray<number>
): number {
  const maxRender = renderNoises.reduce((m, n) => Math.max(m, n), 0);
  return Math.max(maxRender * FLOOR_MARGIN, OBSERVED_AA_FLOOR * FLOOR_MARGIN);
}

async function renderTwice(
  page: Page,
  scene: Scene,
  envelope: string
): Promise<number | null> {
  const render = async () => {
    await cleanCanvas(page);
    await pastePayload(page, envelope);
    await waitForSettlement(page, [scene.name]);
    return decodePng(await copyPng(page));
  };
  const a = await render();
  const b = await render();
  if (a.width !== b.width || a.height !== b.height) {
    return null;
  }
  return diffImages(a, b).diffRatio;
}

/** Paste each sample scene twice and diff Figma-vs-Figma to measure render
 * determinism, then write calibration.json into the run dir. */
export async function calibrate(input: {
  page: Page;
  dir: RunDir;
  scenes: ReadonlyArray<{ scene: Scene; envelope: string }>;
}): Promise<Calibration> {
  const figmaRenderNoise: Record<string, number> = {};
  for (const { scene, envelope } of input.scenes) {
    const noise = await renderTwice(input.page, scene, envelope);
    if (noise !== null) {
      figmaRenderNoise[scene.id] = noise;
    }
  }
  const noises = Object.values(figmaRenderNoise);
  const calibration: Calibration = {
    figmaRenderNoise,
    maxRenderNoise: noises.reduce((m, n) => Math.max(m, n), 0),
    recommendedNoiseFloor: recommendNoiseFloor(noises),
  };
  writeFileSync(
    resolve(input.dir.root, "calibration.json"),
    `${JSON.stringify(calibration, null, 2)}\n`
  );
  return calibration;
}
