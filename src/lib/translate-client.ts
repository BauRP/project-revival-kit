import { translateText } from "@/lib/translate.functions";

interface CacheEntry {
  translated?: string;
  error?: string;
  promise?: Promise<string | null>;
}

const cache = new Map<string, CacheEntry>();
const keyOf = (text: string, src: string, tgt: string) => `${src}>${tgt}::${text}`;

async function callWithRetry(text: string, src: string, tgt: string, attempts = 2): Promise<string | null> {
  let lastErr: string | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await translateText({ data: { text, sourceLanguage: src, targetLanguage: tgt } });
      if (res.ok) return res.translated;
      lastErr = res.error;
      if (res.error === "rate_limited" || res.error === "payment_required") break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "unknown";
    }
    await new Promise((r) => setTimeout(r, 350 * (i + 1)));
  }
  const k = keyOf(text, src, tgt);
  const entry = cache.get(k) || {};
  entry.error = lastErr || "unknown";
  entry.promise = undefined;
  cache.set(k, entry);
  return null;
}

/** LLM translate with in-memory de-dup cache. Returns translated text or null. */
export async function translateLLM(text: string, source: string, target: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (source === target) return null;
  const k = keyOf(trimmed, source, target);
  const hit = cache.get(k);
  if (hit?.translated) return hit.translated;
  if (hit?.promise) return hit.promise;
  const p = callWithRetry(trimmed, source, target).then((r) => {
    if (r) cache.set(k, { translated: r });
    return r;
  });
  cache.set(k, { ...(hit || {}), promise: p });
  return p;
}

export function getTranslationError(text: string, source: string, target: string): string | undefined {
  return cache.get(keyOf(text.trim(), source, target))?.error;
}

export function clearTranslationError(text: string, source: string, target: string) {
  const k = keyOf(text.trim(), source, target);
  const hit = cache.get(k);
  if (hit) {
    hit.error = undefined;
    cache.set(k, hit);
  }
}
