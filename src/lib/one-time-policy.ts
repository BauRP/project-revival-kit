/** Local one-time attachment identity and replay prevention keys. */
export function consumedMediaKey(fileId: string): string {
  if (!fileId || fileId.length > 256) throw new Error("Invalid one-time media ID");
  return `consumed-media::${fileId}`;
}
export function isConsumedMediaRecord(data: unknown): boolean {
  return !!data && typeof data === "object" &&
    (data as { consumed?: unknown }).consumed === true;
}

/**
 * Produce a set of revoked file IDs once, instead of scanning every message
 * for every individual tombstone during a large restore. Ignore unfinished
 * or unrelated keys; they are not valid consumed-media identities.
 */
export function consumedMediaFileIds(revoked: ReadonlySet<string>): Set<string> {
  const prefix = "consumed-media::";
  const result = new Set<string>();
  for (const key of revoked) {
    if (key.startsWith(prefix) && key.length > prefix.length) {
      result.add(key.slice(prefix.length));
    }
  }
  return result;
}

/** Test a message against the precomputed IDs without constructing keys. */
export function hasConsumedMediaReference(
  message: Record<string, unknown>,
  consumedIds: ReadonlySet<string>,
): boolean {
  const media = message.media;
  if (!media || typeof media !== "object" || Array.isArray(media)) return false;
  const fileId = (media as { fileId?: unknown }).fileId;
  return typeof fileId === "string" && consumedIds.has(fileId);
}

/** Never resurrect a viewed attachment from an older encrypted backup. */
export function isProtectedByConsumedTombstone(fileId: string, revoked: ReadonlySet<string>): boolean {
  return revoked.has(consumedMediaKey(fileId));
}
export function sanitizeRestoredOneTimeMessage<T extends object>(
  message: T, revoked: ReadonlySet<string>,
): T {
  const media = (message as { media?: unknown }).media;
  if (!media || typeof media !== "object" || !("fileId" in media) ||
      typeof media.fileId !== "string" || !isProtectedByConsumedTombstone(media.fileId, revoked)) return message;
  return { ...message, media: undefined, oneTimeConsumed: true };
}
