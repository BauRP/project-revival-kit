/**
 * Cache eviction is not a hard disk quota. Never sacrifice an attachment
 * that a conversation still references, or an upload not yet attached to a
 * sent message. Only tagged received-cache media may expire. Old untagged
 * records are preserved because their provenance cannot be proven. Received
 * media gets an hour of grace before optional cleanup.
 */
export const MEDIA_ORPHAN_GRACE_MS = 60 * 60 * 1000;

export function canEvictUnreferencedMedia(
  record: { fileId: string; storedAt: number; origin?: "local" | "received" },
  referenced: ReadonlySet<string>,
  now: number,
  graceMs: number = MEDIA_ORPHAN_GRACE_MS,
): boolean {
  if (referenced.has(record.fileId) || record.origin !== "received") return false;
  if (!Number.isFinite(now) || !Number.isFinite(graceMs) || graceMs < 0)
    return false;
  if (!Number.isFinite(record.storedAt) || record.storedAt < 0 ||
      record.storedAt > now) return false;
  return now - record.storedAt >= graceMs;
}

/**
 * An authenticated download may use the same fileId as another local
 * attachment. Never replace an existing local upload or old legacy blob.
 * A retransmission of a confirmed received cache entry is idempotent only
 * if its signed metadata still matches the original.
 */
export function isMatchingReceivedCache(
  existing: { origin?: string; name: string; mimeType: string; size: number; data?: Blob },
  incoming: { name: string; mimeType: string; size: number },
): boolean {
  return existing.origin === "received" &&
    existing.name === incoming.name &&
    existing.mimeType === incoming.mimeType &&
    existing.size === incoming.size &&
    existing.data instanceof Blob &&
    existing.data.size === existing.size;
}

/** Count committed binary bytes, not sender-controlled metadata. Do not use
 * a corrupt size field to evade the local cache budget or delete unrelated
 * user media based on a false "free space" calculation.
 */
export function verifiedBlobSize(row: { size: number; data: Blob }): number {
  if (!(row.data instanceof Blob) ||
      !Number.isSafeInteger(row.size) || row.size < 0 ||
      row.size !== row.data.size)
    throw new Error("Stored media size does not match committed attachment");
  return row.data.size;
}

/** A damaged received-cache blob can be replaced by an authenticated
 * retransmission ONLY if the signed parent message still references exactly
 * the same file metadata. Never replace local uploads, legacy records, or a
 * healthy cached attachment. This is a repair, not a generic overwrite.
 */
export function canRepairReceivedCache(
  existing: { origin?: string; name: string; mimeType: string; size: number; data?: Blob },
  incoming: { name: string; mimeType: string; size: number },
  binary: Blob,
): boolean {
  return existing.origin === "received" &&
    existing.name === incoming.name &&
    existing.mimeType === incoming.mimeType &&
    Number.isSafeInteger(existing.size) && existing.size >= 0 &&
    existing.size === incoming.size &&
    binary instanceof Blob && binary.size === incoming.size &&
    (!(existing.data instanceof Blob) || existing.data.size !== existing.size);
}

/** Allow a damaged received cache to be refetched, but never confuse a
 * corrupt local upload with an absent file that may be silently replaced.
 */
export function needsReceivedCacheRepair(
  record: { origin?: string; size: number; data?: Blob },
): boolean {
  return record.origin === "received" &&
    (!(record.data instanceof Blob) ||
      !Number.isSafeInteger(record.size) || record.size < 0 ||
      record.data.size !== record.size);
}
