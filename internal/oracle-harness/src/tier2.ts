import type { Finding } from "./findings";
import type { GroundTruthElement } from "./ground-truth";
import { attributeCluster } from "./tier2/attribute";
import { clusterMask } from "./tier2/cluster";
import { cropTopLeft, decodePng, diffImages, downsample } from "./tier2/pixel";

// Fraction of the scene a cluster covers → severity 1 (a 5%-area region is
// already a severe visual break).
const SEVERITY_AREA_SCALE = 20;
// Figma's "Copy as PNG" exports at a fixed 2× scale.
const COPY_AS_PNG_SCALE = 2;
// Figma's render is deterministic (WS-2.6 calibration), so any DOM-vs-Figma
// diff is real — but below this ratio it's sub-pixel Chrome-vs-Figma AA (the
// noisiest clean scene sits at ~0.02%). Sub-floor scenes get no region findings.
const NOISE_FLOOR_RATIO = 0.001;

export type Tier2Result = {
  diffRatio: number;
  findings: Array<Finding>;
  diffPng: Buffer;
};

/**
 * Tier-2: compare the browser's DOM screenshot (1×) against Figma's rendered
 * PNG (Copy-as-PNG, 2×). The Figma export crops to content bounds and can hug
 * narrower than the DOM frame, so we align at the top-left, diff the overlap,
 * and emit a `pixel.size` finding for any dimension delta rather than skipping.
 */
export function diffTier2(input: {
  sceneId: string;
  domPng: Uint8Array;
  figmaPng: Uint8Array;
  elements: ReadonlyArray<GroundTruthElement>;
  threshold?: number;
}): Tier2Result | { error: string } {
  const dom = decodePng(input.domPng);
  // Derive the scale from height (the frame height Figma respects) but fall
  // back to the known Copy-as-PNG scale.
  const figmaRaw = decodePng(input.figmaPng);
  const factor =
    dom.height > 0
      ? Math.max(1, Math.round(figmaRaw.height / dom.height))
      : COPY_AS_PNG_SCALE;
  const figma = downsample(figmaRaw, factor);

  const w = Math.min(dom.width, figma.width);
  const h = Math.min(dom.height, figma.height);
  if (w === 0 || h === 0) {
    return {
      error: `no overlap: dom ${dom.width}×${dom.height} vs figma ${figma.width}×${figma.height}`,
    };
  }

  const diff = diffImages(
    cropTopLeft(dom, w, h),
    cropTopLeft(figma, w, h),
    input.threshold
  );
  // Below the noise floor the diff is sub-pixel AA — report the ratio but emit
  // no region findings.
  const clusters =
    diff.diffRatio >= NOISE_FLOOR_RATIO
      ? clusterMask(diff.mask, diff.width, diff.height)
      : [];
  const sceneArea = diff.width * diff.height;

  const findings: Array<Finding> = clusters.map((cluster) => {
    const element = attributeCluster(cluster, input.elements);
    const areaFraction = (cluster.width * cluster.height) / sceneArea;
    return {
      sceneId: input.sceneId,
      tier: 2,
      class: "pixel.region",
      severity: Math.min(1, areaFraction * SEVERITY_AREA_SCALE),
      domPath: element?.domPath,
      clusterBBox: cluster,
    };
  });

  if (dom.width !== figma.width || dom.height !== figma.height) {
    findings.push({
      sceneId: input.sceneId,
      tier: 2,
      class: "pixel.size",
      severity: 1,
      expected: `${dom.width}×${dom.height}`,
      actual: `${figma.width}×${figma.height}`,
    });
  }

  return { diffRatio: diff.diffRatio, findings, diffPng: diff.diffPng };
}
