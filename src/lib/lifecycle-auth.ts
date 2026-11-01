/**
 * Validation of remote lifecycle commands. Pure functions so security rules
 * can be regression-tested without a WebView, Tor service or IndexedDB.
 */
export interface ChatParticipants {
  from: string;
  to: string;
}

const allowedFields = new Set([
  "isEdited", "editedText", "deletedForEveryone",
  "pinnedAt", "pinnedBy", "clearPin",
]);

export function canApplyRemoteLifecycle(
  original: ChatParticipants | null | undefined,
  sender: string,
  recipient: string,
  chatKey: string,
  patch: unknown,
): patch is Record<string, unknown> {
  if (!original || !sender || !recipient || sender === recipient) return false;
  if (!original.from || !original.to || original.from === original.to) return false;
  if ([original.from, original.to].sort().join("__") !== chatKey) return false;
  if (!([original.from, original.to].includes(sender) &&
        [original.from, original.to].includes(recipient))) return false;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const fields = Object.keys(patch);
  if (!fields.length || fields.some((field) => !allowedFields.has(field))) return false;
  const p = patch as Record<string, unknown>;
  if ("editedText" in p && (typeof p.editedText !== "string" || p.editedText.length > 200000)) return false;
  if ("isEdited" in p && typeof p.isEdited !== "boolean") return false;
  if ("deletedForEveryone" in p && p.deletedForEveryone !== true) return false;
  if ("pinnedAt" in p && (typeof p.pinnedAt !== "number" ||
      !Number.isSafeInteger(p.pinnedAt) || p.pinnedAt < 0)) return false;
  if ("pinnedBy" in p && p.pinnedBy !== sender) return false;
  if ("clearPin" in p && p.clearPin !== true) return false;
  const ownerOnly = "isEdited" in p || "editedText" in p || "deletedForEveryone" in p;
  if (ownerOnly && original.from !== sender) return false;
  return true;
}

/** Reject stale or implausibly future-dated events. */
export function acceptsLifecycleTimestamp(
  lastRemoteAt: unknown,
  incomingAt: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof incomingAt !== "number" || !Number.isSafeInteger(incomingAt) ||
      incomingAt <= 0 || incomingAt > now + 10 * 60_000) return false;
  return typeof lastRemoteAt !== "number" || incomingAt > lastRemoteAt;
}
