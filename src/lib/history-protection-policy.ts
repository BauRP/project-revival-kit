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

/** An old toggle is no longer eligible for the durable Tor outbox after
 * another toggle has committed. Both timestamp and enabled flag must agree.
 */
export function isCurrentHistoryProtectionDispatch(
  row: { chatKey: string; messageId: string; updatedAt: number;
    data: Record<string, unknown> } | undefined,
  peer: string, enabled: unknown, updatedAt: unknown,
): boolean {
  return !!row && row.chatKey === "history-protection-local" &&
    row.messageId === peer && row.key === `history-protection::local::${peer}` &&
    typeof enabled === "boolean" && typeof updatedAt === "number" &&
    Number.isSafeInteger(updatedAt) && updatedAt > 0 &&
    row.updatedAt === updatedAt && row.data?.updatedAt === updatedAt &&
    row.data?.enabled === enabled;
}
