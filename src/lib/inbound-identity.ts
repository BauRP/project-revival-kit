/** Pure rule for duplicate signed message IDs. A collision from a different
 * author or with altered content is a rejected frame, not a delivered ACK.
 * Transport status and sender-side object URLs are intentionally ignored.
 */
export interface InboundIdentityMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  media?: unknown;
  caption?: unknown;
  deleteAt?: unknown;
  silent?: unknown;
  oneTimeView?: unknown;
  roundVideo?: unknown;
}
const mediaIdentity = (media: unknown): string | null => {
  if (media == null) return null;
  if (typeof media !== "object" || Array.isArray(media)) return "invalid";
  const m = media as Record<string, unknown>;
  return JSON.stringify([m.fileId, m.id, m.name, m.size, m.mimeType, m.type]);
};
export function duplicateMessageMatches(
  existing: InboundIdentityMessage, incoming: InboundIdentityMessage,
): boolean {
  return existing.id === incoming.id && existing.from === incoming.from &&
    existing.to === incoming.to && existing.text === incoming.text &&
    existing.timestamp === incoming.timestamp &&
    mediaIdentity(existing.media) === mediaIdentity(incoming.media) &&
    (existing.caption ?? null) === (incoming.caption ?? null) &&
    (existing.deleteAt ?? null) === (incoming.deleteAt ?? null) &&
    (existing.silent === true) === (incoming.silent === true) &&
    (existing.oneTimeView === true) === (incoming.oneTimeView === true) &&
    (existing.roundVideo === true) === (incoming.roundVideo === true);
}
