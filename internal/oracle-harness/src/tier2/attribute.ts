import type { GroundTruthElement } from "../ground-truth";
import type { Cluster } from "./cluster";

const MIN_COVERAGE = 0.6;

/**
 * Attribute a diff cluster to the deepest visible DOM element whose rect covers
 * at least 60% of the cluster. Cluster coords are in the (1×) comparison image,
 * which equals CSS px, so element rects compare directly. Returns null when no
 * element covers the cluster (e.g. a stray-pixel region).
 */
export function attributeCluster(
  cluster: Cluster,
  elements: ReadonlyArray<GroundTruthElement>
): GroundTruthElement | null {
  const clusterArea = cluster.width * cluster.height;
  if (clusterArea === 0) {
    return null;
  }
  let best: GroundTruthElement | null = null;
  let bestDepth = -1;
  for (const el of elements) {
    if (!el.visible) {
      continue;
    }
    const ix = Math.max(cluster.x, el.rect.x);
    const iy = Math.max(cluster.y, el.rect.y);
    const ix2 = Math.min(cluster.x + cluster.width, el.rect.x + el.rect.width);
    const iy2 = Math.min(
      cluster.y + cluster.height,
      el.rect.y + el.rect.height
    );
    const overlap = Math.max(0, ix2 - ix) * Math.max(0, iy2 - iy);
    if (overlap / clusterArea < MIN_COVERAGE) {
      continue;
    }
    const depth = el.domPath.split(">").length;
    if (depth > bestDepth) {
      best = el;
      bestDepth = depth;
    }
  }
  return best;
}
