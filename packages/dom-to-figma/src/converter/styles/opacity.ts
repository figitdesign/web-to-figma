export function parseOpacity(value: string | undefined | null): number {
  if (!value) {
    return 1;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(1, Math.max(0, parsed));
}
