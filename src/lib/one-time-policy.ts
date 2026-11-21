/** Local one-time attachment identity and replay prevention keys. */
export function consumedMediaKey(fileId: string): string {
  if (!fileId || fileId.length > 256) throw new Error("Invalid one-time media ID");
  return `consumed-media::${fileId}`;
}
/** Canonical persisted key wins even when the marker payload is corrupt.
 * Only use this for ROWS read from the consumed-media index, never for
 * untrusted stand-alone objects supplied by a network peer.
 */
export function isCanonicalConsumedMediaRow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.chatKey === "consumed-media" &&
    typeof row.messageId === "string" && row.messageId.length > 0 &&
    row.messageId.length <= 256 &&
    row.key === `consumed-media::${row.messageId}`;
}
export function hasStoredConsumedMediaMarker(value: unknown): boolean {
  return value !== undefined;
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
