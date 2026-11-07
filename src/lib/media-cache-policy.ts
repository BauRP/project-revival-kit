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
