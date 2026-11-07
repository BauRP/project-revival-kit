/**
 * Persist the Keystore-wrapped AES-256 data key exactly once in the legacy
 * settings IndexedDB. No protected messages are written by this module.
 * Actual encryption adoption must use this key BEFORE migrating any row.
 *
 * Call acquirePersistedLocalRecordKey ONLY with a reliable, live check of
 * all encrypted rows. If a key is missing while protected data exists, never
 * replace it with a fresh key or mark that data as an empty installation.
 */
import { dbAddStrict, dbGetStrict } from "./storage";
import { createWrappedLocalRecordKey, openWrappedLocalRecordKey } from "./local-record-key";

const MASTER_KEY_ID = "trivo-local-record-key-v1";

export interface PersistedLocalKey {
  version: 1;
  wrapped: string;
}

export function parsePersistedLocalKey(value: unknown): PersistedLocalKey | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored local encryption key has invalid metadata");
  }
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.wrapped !== "string" ||
      v.wrapped.length < 8 || v.wrapped.length > 512)
    throw new Error("Stored local encryption key is corrupt");
  return { version: 1, wrapped: v.wrapped };
}

interface KeyBootstrap<K> {
  read: () => Promise<unknown>;
  insert: (record: PersistedLocalKey) => Promise<void>;
  open: (wrapped: string) => Promise<K>;
  create: () => Promise<{ key: K; wrapped: string }>;
  /** Must check the actual protected storage, not merely an in-memory flag. */
  isProtectedStoreEmpty: () => Promise<boolean>;
}

/**
 * Crash safe: first durable insert wins, concurrent initializers re-read the
 * winner. Error on unreadable settings/Keystore or missing key with ciphertext.
 */
export async function acquireProtectedStorageKey<K>(deps: KeyBootstrap<K>): Promise<K> {
  const existing = parsePersistedLocalKey(await deps.read());
  if (existing) return deps.open(existing.wrapped);
  if (!await deps.isProtectedStoreEmpty()) {
    throw new Error("Protected messages exist without their original encryption key");
  }
  const created = await deps.create();
  if (!created || typeof created.wrapped !== "string" ||
      created.wrapped.length < 8 || created.wrapped.length > 512)
    throw new Error("Keystore returned an invalid wrapped key");
  try {
    await deps.insert({ version: 1, wrapped: created.wrapped });
    return created.key;
  } catch (error) {
    // IDB can abort due to a competing startup or fail after a durable
    // commit. If a wrapper now exists, it is authoritative, not our new key.
    const winner = parsePersistedLocalKey(await deps.read());
    if (winner) return deps.open(winner.wrapped);
    throw error;
  }
}

/**
 * Explicit opt-in: the caller must pass a fresh DB check that covers every
 * encrypted table before this can create a master key. No implicit startup
 * work or browser fallback.
 */
export function acquirePersistedLocalRecordKey(
  isProtectedStoreEmpty: () => Promise<boolean>,
): Promise<CryptoKey> {
  return acquireProtectedStorageKey({
    read: () => dbGetStrict<unknown>("settings", MASTER_KEY_ID),
    insert: (record) => dbAddStrict("settings", MASTER_KEY_ID, record),
    create: createWrappedLocalRecordKey,
    open: openWrappedLocalRecordKey,
    isProtectedStoreEmpty,
  });
}
