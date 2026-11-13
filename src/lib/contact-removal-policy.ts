/** Durable local friend revocation, independent of the chat list. */
import { isValidOnion } from "./onion-id";
export const REMOVED_CONTACT_CHAT_KEY = "removed-contact-local" as const;

export function removedContactKey(onion: string): string {
  if (!isValidOnion(onion) || !/^[a-z2-7]{56}\.onion$/.test(onion))
    throw new Error("Invalid contact identity for revocation");
  return JSON.stringify(["removed-contact", onion]);
}
export function createRemovedContactMarker(onion: string, timestamp: number) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new Error("Invalid contact removal time");
  return {
    key: removedContactKey(onion),
    chatKey: REMOVED_CONTACT_CHAT_KEY,
    messageId: onion,
    updatedAt: timestamp,
    data: { removed: true as const },
  };
}
export function isRemovedContactMarker(row: unknown): row is ReturnType<typeof createRemovedContactMarker> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const v = row as Record<string, unknown>;
  if (v.chatKey !== REMOVED_CONTACT_CHAT_KEY || typeof v.messageId !== "string" ||
      !Number.isSafeInteger(v.updatedAt) || (v.updatedAt as number) <= 0 ||
      !v.data || typeof v.data !== "object" ||
      (v.data as Record<string, unknown>).removed !== true) return false;
  try { return v.key === removedContactKey(v.messageId); }
  catch { return false; }
}
