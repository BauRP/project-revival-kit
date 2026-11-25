/**
 * Encrypt legacy Android chat preferences even when the conversation is never
 * opened again. Work runs after first paint in bounded key-only IDB pages.
 *
 * Failure is visible to the caller and leaves recoverable plaintext intact.
 * Account deletion closes the job before dropping the databases, preventing
 * late asynchronous writes from recreating the settings database.
 */
import { dbListKeysByPrefixStrict } from "./storage";
import { readProtectedChatPreferences } from "./protected-chat-preferences";

const LEGACY_PREFIX = "chat-preferences-";
const ENCRYPTED_PREFIX = "chat-preferences-sealed-";
const PAGE_SIZE = 32;
let stopRequested = false;
let running: Promise<number> | null = null;
let stopped = false;

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Ignore sealed records in the same prefix range; never treat ciphertext
 * as a legacy chat ID and write an additional sealed-of-sealed row.
 */
export function legacyPreferenceChatId(key: string): string | null {
  if (typeof key !== "string" || !key.startsWith(LEGACY_PREFIX) ||
      key.startsWith(ENCRYPTED_PREFIX)) return null;
  const id = key.slice(LEGACY_PREFIX.length);
  if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

/** Durable per-record migration; no preloading and no auto-delete on error. */
export async function migrateChatPreferencePages(
  shouldStop: () => boolean = () => false,
  scan: (after?: string) => Promise<string[]> = (after) =>
    dbListKeysByPrefixStrict("settings", LEGACY_PREFIX, after, PAGE_SIZE),
  migrate: (chatId: string) => Promise<unknown> = readProtectedChatPreferences,
  pause: () => Promise<void> = yieldToUI,
): Promise<number> {
  let last: string | undefined;
  let changed = 0;
  while (!shouldStop()) {
    const keys = await scan(last);
    if (!keys.length) break;
    for (const key of keys) {
      if (shouldStop()) return changed;
      const chatId = legacyPreferenceChatId(key);
      if (chatId) {
        await migrate(chatId);
        changed++;
      }
    }
    last = keys[keys.length - 1];
    if (keys.length < PAGE_SIZE) break;
    await pause();
  }
  return changed;
}

/** One active migration per WebView. Automatic retry only on next foreground
 * or next app restart; an invalid record is NOT skipped or silently erased.
 */
export function startChatPreferenceMigration(): Promise<number> {
  if (stopped || stopRequested) return Promise.resolve(0);
  if (running) return running;
  const task = migrateChatPreferencePages(() => stopRequested);
  running = task;
  void task.finally(() => { if (running === task) running = null; })
    .catch(() => undefined);
  return task;
}

/** Await the current work before the account wipe; no new jobs can start. */
export async function stopChatPreferenceMigrationForWipe(): Promise<void> {
  stopped = true;
  stopRequested = true;
  if (running) {
    try { await running; }
    catch { /* prior migration failed; wipe still owns the database lifecycle */ }
  }
}
