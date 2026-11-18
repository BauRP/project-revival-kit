/** Ignore older and equal-timestamp signed reactions. A repeated Tor retry
 * must not roll the visible state back or trigger another UI notification.
 */
export function shouldApplyRemoteReaction(previousAt: unknown, incomingAt: number): boolean {
  return typeof previousAt !== "number" ||
    (Number.isSafeInteger(previousAt) && incomingAt > previousAt);
}

/** Discard malformed legacy reaction values without losing valid reactions. */
export function normalizeLegacyReactions(value: unknown): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const [id, actors] of Object.entries(value)) {
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id) ||
        !actors || typeof actors !== "object" || Array.isArray(actors)) continue;
    const clean: Record<string, string> = Object.create(null);
    for (const [actor, emoji] of Object.entries(actors)) {
      if (actor && actor.length <= 128 && !/[\u0000-\u001f\u007f]/.test(actor) &&
          typeof emoji === "string" && emoji.length > 0 && emoji.length <= 24)
        clean[actor] = emoji;
    }
    map[id] = clean;
  }
  return map;
}

/** A newly sealed reaction is allowed into the durable outbox only while
 * its immutable event ID, state and timestamp remain current.
 */
export function isCurrentReactionEnqueue(
  row: { chatKey: string; messageId: string; updatedAt: number;
    data: Record<string, unknown> } | undefined,
  peer: string, messageId: string, eventId: string,
  emoji: unknown, updatedAt: unknown,
): boolean {
  return !!row && row.chatKey === `reaction::${peer}` &&
    row.messageId === messageId && row.data?.outboundEventId === eventId &&
    row.data?.outboundPending === true && row.data?.emoji === emoji &&
    Number.isSafeInteger(updatedAt) && row.updatedAt === updatedAt;
}
