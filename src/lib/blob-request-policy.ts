/**
 * Limit signed-but-untrusted requests for partial Tor media.
 * Large malformed index arrays could otherwise monopolize the WebView event
 * loop and cause thousands of unnecessary encrypted chunk sends.
 */
export const MAX_MEDIA_CHUNKS = Math.ceil((1024 * 1024 * 1024) / (48 * 1024));
export function boundedChunkIndexes(value: unknown): Set<number> | null {
  if (!Array.isArray(value) || value.length > MAX_MEDIA_CHUNKS) return null;
  const values = new Set<number>();
  for (const index of value) {
    if (typeof index !== "number" || !Number.isSafeInteger(index) ||
        index < 0 || index >= MAX_MEDIA_CHUNKS) return null;
    values.add(index);
  }
  return values;
}

/** An authenticated peer can still submit invalid JSON types and oversized
 * identifiers. Never coerce hostile objects with String() or Number().
 */
/**
 * A sender must cap a newly requested media transfer to one small window.
 * Older peers without window fields retain the legacy protocol; new peers
 * never force a one-gigabyte attachment into the Tor send queue at once.
 */
export interface MediaTransferWindow { start: number; count: number }
export const MAX_MEDIA_TRANSFER_WINDOW = 128;
export function boundedMediaTransferWindow(
  start: unknown, count: unknown, totalChunks: number,
): MediaTransferWindow | null {
  if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 ||
      totalChunks > MAX_MEDIA_CHUNKS ||
      !Number.isSafeInteger(start) || typeof start !== "number" ||
      start < 0 || start >= totalChunks ||
      !Number.isSafeInteger(count) || typeof count !== "number" ||
      count < 1 || count > MAX_MEDIA_TRANSFER_WINDOW)
    return null;
  return { start, count: Math.min(count, totalChunks - start) };
}

export function validBlobFileId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f\\/]/.test(value);
}
