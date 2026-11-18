/** Pure per-chat history protection policy, shared by UI and Tor validation. */
export function deniedByHistoryProtection(enabled: boolean, patch: Record<string, unknown>): boolean {
  return enabled && ("isEdited" in patch || "editedText" in patch || "deletedForEveryone" in patch);
}

/** Existing but corrupted per-chat protection must never silently become
 * "disabled" during an authenticated remote edit/delete delivery.
 * A missing record still means the user has not enabled protection.
 * Pin and non-destructive changes remain permitted.
 */
export function deniedByStoredHistoryProtection(
  record: { data?: unknown } | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (!record) return false;
  const data = record.data;
  const valid = !!data && typeof data === "object" && !Array.isArray(data) &&
    typeof (data as { enabled?: unknown }).enabled === "boolean" &&
    typeof (data as { updatedAt?: unknown }).updatedAt === "number" &&
    Number.isSafeInteger((data as { updatedAt: number }).updatedAt) &&
    (data as { updatedAt: number }).updatedAt > 0;
  return deniedByHistoryProtection(!valid || (data as { enabled: boolean }).enabled, patch);
}
