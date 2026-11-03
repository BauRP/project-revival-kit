/**
 * Legacy API name retained for existing callers. No encrypted chat text
 * is ever sent to a hosted LLM. Use only the bundled offline dictionary;
 * when unavailable return null (never claim a translation happened).
 */
import { translateWithBundledDictionary } from "./translation-config";

const cache = new Map<string, { translated?: string; error?: string }>();
const MAX_ENTRIES = 200;
const keyOf = (text: string, source: string, target: string): string =>
  JSON.stringify([source, target, text]);

export async function translateLLM(
  text: string, source: string, target: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || source === target) return null;
  const key = keyOf(trimmed, source, target);
  const existing = cache.get(key);
  if (existing?.translated) return existing.translated;
  const translated = translateWithBundledDictionary(trimmed, source, target);
  cache.delete(key);
  cache.set(key, translated ? { translated } : { error: "offline_model_unavailable" });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return translated || null;
}

export function getTranslationError(
  text: string, source: string, target: string,
): string | undefined {
  return cache.get(keyOf(text.trim(), source, target))?.error;
}
export function clearTranslationError(
  text: string, source: string, target: string,
): void {
  const key = keyOf(text.trim(), source, target);
  const entry = cache.get(key);
  if (entry) cache.set(key, { ...entry, error: undefined });
}
