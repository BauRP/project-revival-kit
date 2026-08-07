// Phase 3 §2 — Local STT cache. Avoids re-billing transcription of the same
// audio. Keyed by a stable hash of the audio URL (Room-equivalent on web).

const KEY = "trivo-stt-cache-v1";
const MAX_ENTRIES = 200;

type CacheMap = Record<string, { text: string; ts: number }>;

function read(): CacheMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    return {};
  }
}

function write(map: CacheMap): void {
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].ts - a[1].ts);
      const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(KEY, JSON.stringify(map));
    }
  } catch {
    /* ignore */
  }
}

export function getCachedTranscription(audioUrl: string): string | null {
  const map = read();
  return map[audioUrl]?.text ?? null;
}

export function cacheTranscription(audioUrl: string, text: string): void {
  const map = read();
  map[audioUrl] = { text, ts: Date.now() };
  write(map);
}
