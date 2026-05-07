export function toErrorMessage(
  error: unknown,
  fallback = "Something went wrong."
): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
}
