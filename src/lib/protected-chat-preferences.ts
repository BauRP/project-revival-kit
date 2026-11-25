/**
 * Android-only AES-GCM protection for each chat's blocking, disappearing,
 * mute, archive and one-time preferences. Web preview stays on legacy storage.
 *
 * The sealed value is committed, authenticated and re-read BEFORE removing
 * old plaintext. A crash can resume without losing the old value. All saves
 * use a committed IndexedDB compare-and-write to avoid lost edits.
 */
import {
  dbDeleteIfUnchangedStrict, dbGetStrict, dbPutIfUnchangedStrict,
  ConcurrentProtectedWriteError,
} from "./storage";
import { acquireLocalDataKey } from "./protected-record-inventory";
import { sealLocalRecord, openLocalRecord, type SealedLocalRecord } from "./local-record-crypto";
import {
  validateChatPreferenceState, type ChatPreferenceState,
} from "./chat-preferences";

export const PROTECTED_CHAT_PREFS_PREFIX = "chat-preferences-sealed-";
const LEGACY_PREFIX = "chat-preferences-";
const TABLE = "settings";

interface ProtectedChatPreferences {
  version: 1;
  sealed: SealedLocalRecord;
}

function ids(chatId: string): { plain: string; secure: string } {
  if (typeof chatId !== "string" || !chatId || chatId.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(chatId))
    throw new Error("Invalid chat identity for protected preferences");
  return { plain: LEGACY_PREFIX + chatId, secure: PROTECTED_CHAT_PREFS_PREFIX + chatId };
}

function parseEnvelope(value: unknown): ProtectedChatPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as ProtectedChatPreferences).version !== 1 ||
      !(value as ProtectedChatPreferences).sealed ||
      typeof (value as ProtectedChatPreferences).sealed !== "object")
    throw new Error("Invalid protected chat settings");
  return value as ProtectedChatPreferences;
}

async function decrypt(
  key: CryptoKey, secureId: string, record: unknown,
): Promise<ChatPreferenceState> {
  const envelope = parseEnvelope(record);
  const json = await openLocalRecord(key, TABLE, secureId, envelope.sealed);
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("Invalid authenticated chat settings JSON"); }
  return validateChatPreferenceState(value);
}

async function encrypt(
  key: CryptoKey, secureId: string, value: ChatPreferenceState,
): Promise<ProtectedChatPreferences> {
  return { version: 1,
    sealed: await sealLocalRecord(key, TABLE, secureId,
      JSON.stringify(validateChatPreferenceState(value))) };
}

/** Always reject conflicting plaintext rather than deleting an unknown edit.
 * The old plaintext remains durable when Keystore or ciphertext validation fails.
 */
export async function readProtectedChatPreferences(chatId: string): Promise<ChatPreferenceState> {
  const { plain, secure } = ids(chatId);
  const sealed = await dbGetStrict<unknown>(TABLE, secure);
  const legacy = await dbGetStrict<unknown>(TABLE, plain);
  if (sealed === undefined && legacy === undefined) return {};
  // A damaged plaintext privacy decision must not trigger creation of a new
  // Keystore key during migration. Validate it before any key operation.
  const original = sealed === undefined ? validateChatPreferenceState(legacy) : undefined;
  const key = await acquireLocalDataKey();
  if (sealed !== undefined) {
    const value = await decrypt(key, secure, sealed);
    if (legacy !== undefined) {
      const original = validateChatPreferenceState(legacy);
      if (JSON.stringify(original) !== JSON.stringify(value))
        throw new Error("Conflicting plaintext chat settings require recovery");
      await dbDeleteIfUnchangedStrict(TABLE, plain, legacy);
    }
    return value;
  }
  if (!original) throw new Error("Missing legacy chat settings");
  const encrypted = await encrypt(key, secure, original);
  try {
    await dbPutIfUnchangedStrict(TABLE, secure, undefined, encrypted);
  } catch (error) {
    if (!(error instanceof ConcurrentProtectedWriteError)) throw error;
    // Another WebView may have finished migrating the very same record.
    // Authenticate its committed ciphertext before deciding whether it is
    // safe to finish the migration. A differing privacy decision must NEVER
    // be overwritten or silently treated as equivalent.
    const winner = await dbGetStrict<unknown>(TABLE, secure);
    if (winner === undefined) throw error;
    const winnerState = await decrypt(key, secure, winner);
    if (JSON.stringify(winnerState) !== JSON.stringify(original))
      throw new Error("Conflicting encrypted chat settings require recovery");
  }
  const verified = await decrypt(key, secure, await dbGetStrict(TABLE, secure));
  if (JSON.stringify(verified) !== JSON.stringify(original))
    throw new Error("Encrypted chat settings verification failed");
  await dbDeleteIfUnchangedStrict(TABLE, plain, legacy);
  return verified;
}

/** Save a complete state; never replace ciphertext without a CAS commit.
 * Existing legacy state is migrated before applying a new update.
 */
export async function saveProtectedChatPreferences(
  chatId: string, next: ChatPreferenceState,
): Promise<void> {
  await updateProtectedChatPreferences(chatId, () => next);
}

/** Atomic compare-and-retry for independent UI changes from two WebViews.
 * Each retry decrypts the latest committed state before applying the patch.
 */
export async function updateProtectedChatPreferences(
  chatId: string, update: (previous: ChatPreferenceState) => ChatPreferenceState,
): Promise<ChatPreferenceState> {
  const { secure } = ids(chatId);
  for (let attempt = 0; attempt < 5; attempt++) {
    await readProtectedChatPreferences(chatId);
    const old = await dbGetStrict<unknown>(TABLE, secure);
    const key = await acquireLocalDataKey();
    const previous = old === undefined ? {} : await decrypt(key, secure, old);
    const next = validateChatPreferenceState(update(previous));
    const sealed = await encrypt(key, secure, next);
    try {
      await dbPutIfUnchangedStrict(TABLE, secure, old, sealed);
      return next;
    } catch (error) {
      if (!(error instanceof ConcurrentProtectedWriteError) || attempt === 4)
        throw error;
    }
  }
  throw new Error("Protected chat setting update exhausted retries");
}
