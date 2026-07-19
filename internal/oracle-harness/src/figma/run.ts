import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { GroundTruthElement } from "../ground-truth";
import type { RunDir } from "../run-dir";
import type { Scene } from "../scenes";
import { diffTier1 } from "../tier1";
import { diffTier2 } from "../tier2";
import { cleanCanvas, copyPng, pastePayload, waitForSettlement } from "./paste";

function slug(sceneId: string): string {
  return sceneId.replaceAll("/", "__");
}

export type SceneCapture = {
  sceneId: string;
  settled: boolean;
  tier1Findings: number;
  tier2DiffRatio: number | null;
  tier2Regions: number | null;
  note: string;
};

/** Diff the Figma render against the DOM screenshot; write tier-2 artifacts.
 * Returns the diff ratio + region count, or a note when it can't run. */
function captureTier2(
  dir: RunDir,
  sceneId: string,
  stem: string,
  figmaPng: Buffer
): { diffRatio: number | null; regions: number | null; note: string } {
  const domPngPath = resolve(dir.groundTruth, `${stem}.png`);
  const gtPath = resolve(dir.groundTruth, `${stem}.json`);
  if (!(existsSync(domPngPath) && existsSync(gtPath))) {
    return {
      diffRatio: null,
      regions: null,
      note: "tier-2 skipped: no snapshot",
    };
  }
  const gt = JSON.parse(readFileSync(gtPath, "utf-8")) as {
    elements: Array<GroundTruthElement>;
  };
  const result = diffTier2({
    sceneId,
    domPng: readFileSync(domPngPath),
    figmaPng,
    elements: gt.elements,
  });
  if ("error" in result) {
    return {
      diffRatio: null,
      regions: null,
      note: `tier-2 skipped: ${result.error}`,
    };
  }
  writeFileSync(
    resolve(dir.diff, `${stem}.tier2.json`),
    `${JSON.stringify({ diffRatio: result.diffRatio, findings: result.findings }, null, 2)}\n`
  );
  writeFileSync(resolve(dir.diff, `${stem}.diff.png`), result.diffPng);
  return {
    diffRatio: result.diffRatio,
    regions: result.findings.length,
    note: "",
  };
}

/** Paste one scene, wait for it to render, then capture tier-1 (copy-back) and
 * tier-2 (rendered pixels) into the run dir. Assumes the page is on the file. */
export async function captureScene(input: {
  page: Page;
  dir: RunDir;
  scene: Scene;
  envelope: string;
}): Promise<SceneCapture> {
  const { page, dir, scene, envelope } = input;
  const stem = slug(scene.id);

  await cleanCanvas(page);
  await pastePayload(page, envelope);
  const settlement = await waitForSettlement(page, [scene.name]);
  if (!settlement.ok) {
    await page
      .screenshot({ path: resolve(dir.figma, `${stem}.fail.png`) })
      .catch(() => undefined);
    return {
      sceneId: scene.id,
      settled: false,
      tier1Findings: 0,
      tier2DiffRatio: null,
      tier2Regions: null,
      note: `did not settle (got [${settlement.frames.join(", ")}])`,
    };
  }

  writeFileSync(
    resolve(dir.figma, `${stem}.captured.html`),
    settlement.capturedHtml
  );
  const tier1 = diffTier1(scene.id, envelope, settlement.capturedHtml);
  writeFileSync(
    resolve(dir.diff, `${stem}.tier1.json`),
    `${JSON.stringify(tier1, null, 2)}\n`
  );

  const figmaPng = await copyPng(page);
  writeFileSync(resolve(dir.figma, `${stem}.png`), figmaPng);
  const tier2 = captureTier2(dir, scene.id, stem, figmaPng);

  return {
    sceneId: scene.id,
    settled: true,
    tier1Findings: tier1.length,
    tier2DiffRatio: tier2.diffRatio,
    tier2Regions: tier2.regions,
    note: tier2.note,
  };
}
