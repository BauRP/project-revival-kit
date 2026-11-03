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
