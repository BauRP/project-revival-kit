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

/** Keep only the metadata needed to draw a local deleted-message placeholder.
 * Never retain the supposedly deleted plaintext or its original attachment.
 */
export function redactLocalMessage<T extends { text: string; media?: unknown; caption?: unknown }>(
  message: T,
): T {
  // Fail closed: do not spread arbitrary legacy fields into a supposedly
  // redacted record. They may hold plaintext transcripts, translations,
  // reply previews or newer fields added by a future client.
  // Only stable routing/status metadata needed to display a tombstone stays.
  const original = message as Record<string, unknown>;
  const retainedKeys = [
    "id", "from", "to", "timestamp", "status", "deleteAt", "silent",
    "oneTimeView", "oneTimeConsumed", "roundVideo", "scheduledAt",
  ];
  const shell: Record<string, unknown> = { text: "" };
  for (const key of retainedKeys) {
    if (Object.prototype.hasOwnProperty.call(original, key))
      shell[key] = original[key];
  }
  return shell as unknown as T;
}

/** A backup can contain a deletion tombstone and the obsolete attachment.
 * Skip that attachment unless another surviving message still references it.
 * Do this before allocating decoded Blob buffers.
 */
export function unusedBackupMedia(
  backupMessages: ReadonlyArray<{ id: string; media?: unknown }>,
  deletedIds: ReadonlySet<string>,
  livingMessages: ReadonlyArray<{ media?: unknown }> = [],
): string[] {
  const removed = backupMessages.filter((m) => deletedIds.has(m.id));
  const kept = [
    ...backupMessages.filter((m) => !deletedIds.has(m.id)),
    ...livingMessages,
  ];
  return findUnreferencedMedia(removed, kept);
}
