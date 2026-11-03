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
