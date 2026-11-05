/**
 * A valid signature proves who sent a Tor frame, not that the body is safe.
 * Guard hostile JSON *before* allocating arrays or entering DB transactions.
 */
export function validateDispatchBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.type !== "string" || r.type.length > 64 ||
      typeof r.id !== "string" || r.id.length < 1 || r.id.length > 128) return null;
  return r;
}
export function boundedAcknowledgements(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) return [];
  return value.filter((item): item is string =>
    typeof item === "string" && item.length > 0 && item.length <= 128);
}

/** Reject unsafe identifiers rather than calling String() on hostile JSON.
 * A signed frame still may contain object values with a forged toString.
 */
export function boundedDispatchString(value: unknown, max = 128): string | null {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  return value;
}
