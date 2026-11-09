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

export function sanitizePortableExportPrivacy(
  messages: readonly StoredMessage[],
  lifecycle: readonly LifecycleRecord[],
  blobs: readonly BlobRecord[],
): { messages: StoredMessage[]; blobs: BlobRecord[] } {
  const revoked = new Set(lifecycle.filter((row) =>
    row.chatKey === "consumed-media" &&
    isConsumedMediaRecord(row.data) &&
    isIrreversiblePrivacyMarker(row)
  ).map((row) => row.key));

  return {
    messages: messages.map((msg) =>
      sanitizeRestoredOneTimeMessage(stripSessionMediaUrl(msg), revoked)),
    blobs: blobs.filter((blob) =>
      !isProtectedByConsumedTombstone(blob.fileId, revoked)),
  };
}
