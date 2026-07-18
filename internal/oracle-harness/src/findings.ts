/**
 * A single localized discrepancy. Tier differs produce these without an `id`
 * or `artifacts`; the report layer (WS-1.5) assigns the stable content hash and
 * attaches images. Kept deliberately flat so it serializes cleanly.
 */
export type Finding = {
  sceneId: string;
  tier: 0 | 1 | 2;
  /** Dot-path discrepancy class from {@link DISCREPANCY_CLASSES}. */
  class: DiscrepancyClass;
  /** Normalized magnitude, 0..1. */
  severity: number;
  /** `sessionID:localID` of the payload node, when the finding is node-scoped. */
  guid?: string;
  domPath?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  deltaPx?: number;
};

/**
 * The closed vocabulary of tier-0/1 discrepancy classes. New classes are added
 * here deliberately, never as ad-hoc strings, so ranking and the ledger stay
 * stable. Tier-2 adds `pixel.region` separately.
 */
const DISCREPANCY_CLASSES = [
  "geometry.x",
  "geometry.y",
  "geometry.width",
  "geometry.height",
  "node.missing",
  "node.extra",
  "paint.solid.color",
  "paint.opacity",
  "text.fontSize",
  "text.fontFamily",
  "text.fontWeight",
  "text.lineHeight",
  "stroke.width",
  "radius.topLeft",
  "radius.topRight",
  "radius.bottomRight",
  "radius.bottomLeft",
] as const;

type DiscrepancyClass = (typeof DISCREPANCY_CLASSES)[number];

/** Divisor mapping a pixel delta to a 0..1 severity (8px → severity 1). */
const SEVERITY_PX_SCALE = 8;

/** Map a pixel delta to a clamped 0..1 severity. */
export function severityFromDelta(deltaPx: number): number {
  const s = Math.abs(deltaPx) / SEVERITY_PX_SCALE;
  return Math.min(1, Math.max(0, s));
}
