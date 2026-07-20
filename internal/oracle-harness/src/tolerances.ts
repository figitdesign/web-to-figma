/**
 * Every parity tolerance, ratchet epsilon, and severity scale in one place so
 * the ratchet can only be moved deliberately. The only allowed way to improve
 * a number is to fix the converter — never edit this file to make a run pass.
 * Changes here are calibration decisions (WS-2.6), reviewed on their own.
 */

/** Max per-axis geometry deviation before a tier-0/1 finding (px). */
export const GEOMETRY_TOLERANCE_PX = 0.55;

/** Pixel delta → severity 1 divisor (8px ≈ severity 1). */
export const SEVERITY_PX_SCALE = 8;

/** Tier-2 cluster area fraction → severity scale (5% area ≈ severity 1). */
export const SEVERITY_AREA_SCALE = 20;

/** Below this tier-2 diff ratio a scene is sub-pixel AA noise (no findings). */
export const NOISE_FLOOR_RATIO = 0.001;

/** Ratchet: a scene's tier-0/1 maxDeltaPx may grow by at most this (px). */
export const MAX_DELTA_EPSILON_PX = 0.25;

/** Ratchet: a scene's tier-2 diffRatio may grow by at most this. */
export const DIFF_RATIO_EPSILON = 0.002;
