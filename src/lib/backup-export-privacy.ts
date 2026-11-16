/**
 * A viewed one-time attachment is irrevocably consumed: a newly exported
 * archive must not contain its binary data even if an old Blob survived a
 * crash before local cleanup. Preserve the irreversible lifecycle marker,
 * and sanitize the corresponding message preview in the same snapshot.
 *
 * The input comes from one Dexie snapshot, so the consumed-marker decision
 * cannot race against another transaction while composing the archive.
 */
import type { BlobRecord, LifecycleRecord, StoredMessage } from "./dexie-db";
import { isConsumedMediaRecord, isProtectedByConsumedTombstone } from "./one-time-policy";
import { sanitizeRestoredOneTimeMessage } from "./one-time-policy";
import { isIrreversiblePrivacyMarker } from "./backup-merge-policy";
import { stripSessionMediaUrl } from "./backup-media-policy";
import { LOCAL_DELETED_CHAT_KEY, isDeletedMessageRecord, unusedBackupMedia } from "./message-deletion-policy";
import { lifecycleRowsToPurgeForDeletedMessages } from "./backup-merge-policy";

export function sanitizePortableExportPrivacy(
  messages: readonly StoredMessage[],
  lifecycle: readonly LifecycleRecord[],
  blobs: readonly BlobRecord[],
): { messages: StoredMessage[]; lifecycle: LifecycleRecord[]; blobs: BlobRecord[] } {
  const revoked = new Set(lifecycle.filter((row) =>
    row.chatKey === "consumed-media" &&
    isConsumedMediaRecord(row.data) &&
    isIrreversiblePrivacyMarker(row)
  ).map((row) => row.key));

  // A crash or an older app version may have left private message or edit
  // plaintext beside an authoritative deletion tombstone. Do not copy those
  // bytes into a NEW portable archive, even when cleanup was interrupted.
  const deletedIds = new Set(lifecycle.filter((row) =>
    row.chatKey === LOCAL_DELETED_CHAT_KEY &&
    isDeletedMessageRecord(row.data) &&
    isIrreversiblePrivacyMarker(row)
  ).map((row) => row.messageId));
  const staleLifecycle = new Set(lifecycleRowsToPurgeForDeletedMessages(
    lifecycle, deletedIds,
  ));
  const unusedDeletedMedia = new Set(unusedBackupMedia(messages, deletedIds));

  return {
    messages: messages.filter((msg) => !deletedIds.has(msg.id))
      .map((msg) => sanitizeRestoredOneTimeMessage(stripSessionMediaUrl(msg), revoked)),
    lifecycle: lifecycle.filter((row) => !staleLifecycle.has(row)),
    blobs: blobs.filter((blob) =>
      !unusedDeletedMedia.has(blob.fileId) &&
      !isProtectedByConsumedTombstone(blob.fileId, revoked)),
  };
}
