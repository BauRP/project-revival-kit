/** Local one-time attachment identity and replay prevention keys. */
export function consumedMediaKey(fileId: string): string {
  if (!fileId || fileId.length > 256) throw new Error("Invalid one-time media ID");
  return `consumed-media::${fileId}`;
}
export function isConsumedMediaRecord(data: unknown): boolean {
  return !!data && typeof data === "object" &&
    (data as { consumed?: unknown }).consumed === true;
}

/** Never resurrect a viewed attachment from an older encrypted backup. */
export function isProtectedByConsumedTombstone(fileId: string, revoked: ReadonlySet<string>): boolean {
  return revoked.has(consumedMediaKey(fileId));
}
export function sanitizeRestoredOneTimeMessage<T extends { media?: unknown; oneTimeConsumed?: unknown; oneTimeView?: unknown }>(
  message: T, revoked: ReadonlySet<string>,
): T {
  const media = message.media;
  if (!media || typeof media !== "object" || !("fileId" in media) ||
      typeof media.fileId !== "string" || !isProtectedByConsumedTombstone(media.fileId, revoked)) return message;
  return { ...message, media: undefined, oneTimeConsumed: true };
}
