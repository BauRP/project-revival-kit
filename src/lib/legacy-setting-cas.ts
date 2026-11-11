/**
 * Crash-safe/competing-WebView updates to the legacy settings IndexedDB.
 * Read + compare/write is performed using an actual IDB readwrite transaction
 * in dbPutIfUnchangedStrict. Only a verified compare conflict is retried.
 *
 * A mutation callback MUST be pure (it can run again after a competing write).
 */
import {
  dbGetStrict, dbPutIfUnchangedStrict, ConcurrentProtectedWriteError,
} from "./storage";

export interface ConditionalSettingWrite<T> {
  read: () => Promise<T | undefined>;
  compareWrite: (previous: T | undefined, next: T) => Promise<void>;
}

export interface ConditionalSettingResult<T> {
  value: T | undefined;
  changed: boolean;
}

export async function retryConditionalSettingUpdate<T>(
  io: ConditionalSettingWrite<T>,
  change: (previous: T | undefined) => T | undefined,
): Promise<ConditionalSettingResult<T>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const previous = await io.read();
    const next = change(previous);
    if (next === undefined) return { value: previous, changed: false };
    if (JSON.stringify(next) === JSON.stringify(previous))
      return { value: previous, changed: false };
    try {
      await io.compareWrite(previous, next);
      return { value: next, changed: true };
    } catch (error) {
      if (error instanceof ConcurrentProtectedWriteError && attempt < 5) continue;
      throw error;
    }
  }
  throw new Error("Legacy settings update exceeded conflict retry limit");
}

export function updateLegacySetting<T>(
  key: string,
  change: (previous: T | undefined) => T | undefined,
): Promise<ConditionalSettingResult<T>> {
  if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key))
    throw new Error("Invalid legacy setting key");
  return retryConditionalSettingUpdate({
    read: () => dbGetStrict<T>("settings", key),
    compareWrite: (previous, next) =>
      dbPutIfUnchangedStrict("settings", key, previous, next),
  }, change);
}
