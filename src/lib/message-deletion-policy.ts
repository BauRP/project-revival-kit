/**
 * Permanent local deletion markers for messages deliberately removed by their
 * owner or expired. Signed retries and older encrypted archives must not
 * silently recreate those messages.
 */
export const LOCAL_DELETED_CHAT_KEY = "deleted-message-local";
export function deletedMessageKey(messageId: string): string {
  if (!messageId || messageId.length > 128 || /[\u0000-\u001f\u007f]/.test(messageId))
    throw new Error("Invalid deleted message ID");
  return JSON.stringify(["deleted-message", messageId]);
}
export function isDeletedMessageRecord(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as { deleted?: unknown }).deleted === true;
}
export function messageMediaFileId(message: { media?: unknown }): string | null {
  const media = message.media;
  if (!media || typeof media !== "object" || Array.isArray(media)) return null;
  const fileId = (media as { fileId?: unknown }).fileId;
  return typeof fileId === "string" && fileId.length > 0 && fileId.length <= 128 ? fileId : null;
}
export function findUnreferencedMedia(
  removed: ReadonlyArray<{ media?: unknown }>,
  remaining: ReadonlyArray<{ media?: unknown }>,
): string[] {
  const preserved = new Set(remaining.map(messageMediaFileId).filter((x): x is string => x !== null));
  return [...new Set(removed.map(messageMediaFileId)
    .filter((x): x is string => x !== null && !preserved.has(x)))];
}

/** Pure merge policy shared by backup replay checks and regression tests. */
export function mergedDeletionIds(
  current: ReadonlyArray<{messageId:string;data:unknown}>,
  restored: ReadonlyArray<{messageId:string;data:unknown}>,
): Set<string> {
  return new Set([...current, ...restored]
    .filter((entry) => isDeletedMessageRecord(entry.data) &&
      typeof entry.messageId === "string" && entry.messageId.length > 0 &&
      entry.messageId.length <= 128)
    .map((entry) => entry.messageId));
}
