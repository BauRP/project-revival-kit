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
/** A canonical legacy deletion key must be honored even if its stored
 * payload was damaged by an interrupted import. This expects the actual
 * indexed lifecycle ROW, not arbitrary network metadata.
 */
export function isCanonicalDeletedMarkerRow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.chatKey === LOCAL_DELETED_CHAT_KEY &&
    typeof row.messageId === "string" && row.messageId.length > 0 &&
    row.messageId.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(row.messageId) &&
    row.key === deletedMessageKey(row.messageId);
}
export function hasStoredDeletedMessageMarker(value: unknown): boolean {
  return value !== undefined;
}

export function isDeletedMessageRecord(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as { deleted?: unknown }).deleted === true;
}
export function messageMediaFileId(message: unknown): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const media = (message as { media?: unknown }).media;
  if (!media || typeof media !== "object" || Array.isArray(media)) return null;
  const fileId = (media as { fileId?: unknown }).fileId;
  return typeof fileId === "string" && fileId.length > 0 && fileId.length <= 128 ? fileId : null;
}
/** A signed attachment reference is not valid after deletion, consumption or
 * contact revocation. Existence of a revoked-contact key denies access even
 * when its value is damaged: fail closed, not silently re-share private media.
 */
export function mayShareOutgoingAttachment(
  message: { from?: unknown; to?: unknown; media?: unknown } | null | undefined,
  self: string, peer: string, fileId: string,
  deletedRecord: unknown, consumedRecord: unknown, revokedContact: unknown,
): boolean {
  // These are full canonical IndexedDB records, not just .data payloads.
  // A corrupt existing marker must never silently grant old media access.
  return !!message && !!self && !!peer && self !== peer &&
    typeof fileId === "string" && fileId.length > 0 &&
    message.from === self && message.to === peer &&
    messageMediaFileId(message) === fileId &&
    deletedRecord === undefined &&
    consumedRecord === undefined &&
    revokedContact === undefined;
}

export function findUnreferencedMedia(
  removed: ReadonlyArray<{ media?: unknown }>,
  remaining: ReadonlyArray<{ media?: unknown }>,
): string[] {
  const preserved = new Set(remaining.map(messageMediaFileId).filter((x): x is string => x !== null));
  return [...new Set(removed.map(messageMediaFileId)
    .filter((x): x is string => x !== null && !preserved.has(x)))];
}

/** Determine orphaned media IDs without copying every surviving message.
 * Takes just the removed file IDs and a set of still-referenced file IDs;
 * use it inside the same Dexie transaction as the message and Blob deletion.
 */
export function unreferencedFileIds(
  removed: readonly (string | null)[],
  retained: ReadonlySet<string>,
): string[] {
  return [...new Set(removed.filter((id): id is string =>
    typeof id === "string" && id.length > 0 && !retained.has(id)))];
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

/** Verify the source conversation before erasing text, media and pending
 * ciphertext. A stale UI selection from another chat is NEVER permission
 * to redact that chat's message. A missing record is intentionally allowed
 * for an anticipated/cancelled Tor delivery: its tombstone remains durable.
 */
export function mayRedactLocalMessageForChat(
  message: { from?: unknown; to?: unknown } | undefined,
  selfId: string, peerId: string,
): boolean {
  if (typeof selfId !== "string" || !selfId ||
      typeof peerId !== "string" || !peerId || selfId === peerId) return false;
  return message === undefined ||
    (message.from === selfId && message.to === peerId) ||
    (message.from === peerId && message.to === selfId);
}

/** A one-time viewing request must reference the current chat and the exact
 * file identity. A stale cross-chat request cannot consume unrelated media.
 */
export function mayConsumeOneTimeMedia(
  message: {
    from?: unknown; to?: unknown; media?: unknown;
    oneTimeView?: unknown; oneTimeConsumed?: unknown;
  } | undefined,
  fileId: string, peer?: string, deletionRow?: unknown,
): boolean {
  if (deletionRow !== undefined ||
      !message || message.oneTimeView !== true ||
      message.oneTimeConsumed === true || messageMediaFileId(message) !== fileId)
    return false;
  return peer === undefined ||
    (typeof peer === "string" && !!peer &&
      (message.from === peer || message.to === peer));
}

/** A shared attachment may have multiple independently tombstoned parent
 * messages. Choose any authorized, live signed reference; one deleted parent
 * must not block another. Never authorize an empty candidate set.
 */
export async function hasAuthorizedAttachmentParent<T>(
  matchingParents: readonly T[],
  isAuthorized: (parent: T) => Promise<boolean>,
): Promise<boolean> {
  for (const parent of matchingParents) {
    if (await isAuthorized(parent)) return true;
  }
  return false;
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

/** An existing canonical privacy row, even if damaged, denies a late chunk.
 * This receives the full Dexie rows from inside the SAME write transaction.
 */
export function mayPersistIncomingChunkFromRows(
  deletionRow: unknown, consumedRow: unknown,
): boolean {
  return deletionRow === undefined && consumedRow === undefined;
}

/** Bound large IndexedDB anyOf/bulkDelete batches while retaining the
 * caller's single atomic Dexie transaction. Never start an independent
 * transaction in this iterator. */
export function* boundedRecordBatches<T>(
  values: readonly T[],
  size = 256,
): Generator<T[]> {
  if (!Number.isSafeInteger(size) || size < 1 || size > 1024)
    throw new Error("Invalid database batch size");
  for (let i = 0; i < values.length; i += size)
    yield values.slice(i, i + size);
}
