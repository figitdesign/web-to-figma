/**
 * Failure taxonomy so the scheduled workflow's notifications are
 * self-explanatory (WS-3.3). Extended as later tiers land.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  SESSION_EXPIRED: 3,
  PASTE_FAILED: 4,
  EXPORT_FAILED: 5,
  REGRESSION: 6,
  GUARD_REJECTED: 7,
} as const;
