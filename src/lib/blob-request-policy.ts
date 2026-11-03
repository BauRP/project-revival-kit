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
export function validBlobFileId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f\\/]/.test(value);
}
