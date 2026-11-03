/**
 * Private speech transcripts must not be persisted in plaintext localStorage.
 * Retain only a small ephemeral in-memory cache until application shutdown.
 */
const LEGACY_KEY = "trivo-stt-cache-v1";
const MAX_ENTRIES = 200;
const cache = new Map<string, string>();

if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(LEGACY_KEY); }
  catch { /* blocked storage means legacy cache is inaccessible */ }
}
export function clearCachedTranscriptions(): void {
  cache.clear();
}
export function getCachedTranscription(audioUrl: string): string | null {
  return cache.get(audioUrl) ?? null;
}
export function cacheTranscription(audioUrl: string, text: string): void {
  if (!audioUrl || audioUrl.length > 2048 || !text || text.length > 100_000) return;
  cache.delete(audioUrl);
  cache.set(audioUrl, text);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}
