/**
 * Private speech transcripts must not be persisted in plaintext localStorage.
 * Retain only a small ephemeral in-memory cache until application shutdown.
 */
const LEGACY_KEY = "trivo-stt-cache-v1";
const MAX_ENTRIES = 200;
// 200 x 100k-character transcripts used up to 40 MiB of JS string memory,
// in addition to the original audio. Retain a bounded working set instead.
const MAX_TOTAL_TEXT_UNITS = 1_000_000;
const cache = new Map<string, string>();
let cachedTextUnits = 0;

if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(LEGACY_KEY); }
  catch { /* blocked storage means legacy cache is inaccessible */ }
}
export function clearCachedTranscriptions(): void {
  cache.clear();
  cachedTextUnits = 0;
}
export function getCachedTranscription(audioUrl: string): string | null {
  return cache.get(audioUrl) ?? null;
}
export function cacheTranscription(audioUrl: string, text: string): void {
  if (typeof audioUrl !== "string" || !audioUrl || audioUrl.length > 2048 ||
      typeof text !== "string" || !text || text.length > 100_000) return;
  const previous = cache.get(audioUrl);
  if (previous !== undefined) {
    cachedTextUnits -= previous.length;
    cache.delete(audioUrl);
  }
  cache.set(audioUrl, text);
  cachedTextUnits += text.length;
  while (cache.size > MAX_ENTRIES || cachedTextUnits > MAX_TOTAL_TEXT_UNITS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cachedTextUnits -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
}
