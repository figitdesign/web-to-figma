import type { Finding } from "./findings";
import type { GroundTruthElement } from "./ground-truth";
import { attributeCluster } from "./tier2/attribute";
import { clusterMask } from "./tier2/cluster";
import { decodePng, diffImages, downsample } from "./tier2/pixel";

// Fraction of the scene a cluster covers → severity 1 (a 5%-area region is
// already a severe visual break).
const SEVERITY_AREA_SCALE = 20;

export type Tier2Result = {
  diffRatio: number;
  findings: Array<Finding>;
  diffPng: Buffer;
};

/**
 * Tier-2: compare the browser's DOM screenshot (1×) against Figma's rendered
 * PNG (Copy-as-PNG, 2×). Downsamples Figma to match, diffs, clusters the
 * differing pixels, and attributes each cluster to a DOM element. Returns an
 * error when the two images can't be size-aligned.
 */
export function diffTier2(input: {
  sceneId: string;
  domPng: Uint8Array;
  figmaPng: Uint8Array;
  elements: ReadonlyArray<GroundTruthElement>;
  threshold?: number;
}): Tier2Result | { error: string } {
  const dom = decodePng(input.domPng);
  const figmaRaw = decodePng(input.figmaPng);
  const factor = dom.width > 0 ? Math.round(figmaRaw.width / dom.width) : 0;
  const figma = factor >= 1 ? downsample(figmaRaw, factor) : figmaRaw;
  if (figma.width !== dom.width || figma.height !== dom.height) {
    return {
      error: `size mismatch: dom ${dom.width}×${dom.height} vs figma ${figma.width}×${figma.height}`,
    };
  }

  const diff = diffImages(dom, figma, input.threshold);
  const clusters = clusterMask(diff.mask, diff.width, diff.height);
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

  return { diffRatio: diff.diffRatio, findings, diffPng: diff.diffPng };
}
