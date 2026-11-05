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

/** A deletion lifecycle must not retain hidden previous edit text, transcripts
 * or arbitrary future plaintext fields from earlier app versions.
 */
export function deletedLifecycleShell(
  previous: Record<string, unknown> | null | undefined,
  messageId: string,
  owner: string,
  updatedAt: number,
): Record<string, unknown> {
  const deletedFor = new Set<string>(
    Array.isArray(previous?.deletedFor)
      ? previous.deletedFor.filter((item): item is string => typeof item === "string")
      : [],
  );
  deletedFor.add(owner);
  return {
    messageId,
    deletedFor: [...deletedFor],
    deletedForEveryone: previous?.deletedForEveryone === true,
    updatedAt,
    remoteUpdatedAt: typeof previous?.remoteUpdatedAt === "number"
      ? previous.remoteUpdatedAt : undefined,
  };
}

/** An inbound Tor file may only be saved while its original received message
 * still refers to that exact opaque file ID.
 */
export function isExpectedIncomingAttachment(
  message: { from: string; to: string; media?: unknown },
  sender: string,
  recipient: string,
  fileId: string,
): boolean {
  return !!fileId && message.from === sender && message.to === recipient &&
    messageMediaFileId(message) === fileId;
}

/**
 * The signed original message is the authority for the file advertised to
 * the recipient. A malicious sender must not be able to store a larger blob
 * or switch its filename/MIME during a separate chunk transfer.
 */
export function matchesReceivedAttachmentMetadata(
  message: { from: string; to: string; media?: unknown },
  sender: string,
  recipient: string,
  fileId: string,
  name: string,
  mimeType: string,
  size: number,
): boolean {
  if (!isExpectedIncomingAttachment(message, sender, recipient, fileId) ||
      !Number.isSafeInteger(size) || size < 0 ||
      !message.media || typeof message.media !== "object" ||
      Array.isArray(message.media)) return false;
  const media = message.media as Record<string, unknown>;
  return media.name === name && media.mimeType === mimeType &&
    media.size === size;
}

// A file's multipart manifest is not authoritative merely because the
// sender signed its chunks. It must match the original signed chat message.
export function matchesIncomingChunkManifest(
  message: { from: string; to: string; media?: unknown },
  sender: string,
  recipient: string,
  fileId: string,
  name: string,
  mimeType: string,
  totalChunks: number,
  chunkBytes: number,
): boolean {
  if (!isExpectedIncomingAttachment(message, sender, recipient, fileId) ||
      !message.media || typeof message.media !== "object" ||
      Array.isArray(message.media) ||
      !Number.isSafeInteger(totalChunks) || totalChunks < 1 ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 1) return false;
  const media = message.media as Record<string, unknown>;
  return media.name === name && media.mimeType === mimeType &&
    typeof media.size === "number" && Number.isSafeInteger(media.size) &&
    media.size >= 0 &&
    Math.max(1, Math.ceil(media.size / chunkBytes)) === totalChunks;
}

/** A local deletion/one-time consumption is terminal even for chunk writes
 * already queued by the Tor transport before the user pressed Delete/View.
 */
export function mayPersistIncomingChunk(
  localDeletion: unknown, consumedMedia: unknown,
): boolean {
  return !isDeletedMessageRecord(localDeletion) &&
    !(!!consumedMedia && typeof consumedMedia === "object" &&
      !Array.isArray(consumedMedia) &&
      (consumedMedia as { consumed?: unknown }).consumed === true);
}
