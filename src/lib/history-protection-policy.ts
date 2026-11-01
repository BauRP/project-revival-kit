/** Pure per-chat history protection policy, shared by UI and Tor validation. */
export function deniedByHistoryProtection(enabled: boolean, patch: Record<string, unknown>): boolean {
  return enabled && ("isEdited" in patch || "editedText" in patch || "deletedForEveryone" in patch);
}
