/**
 * Shared Android master key for protected local records.
 * Existing encrypted chunks AND the sealed local profile must be checked
 * before bootstrap: a lost key wrapper must NEVER cause a new data key.
 */
import { dbGetStrict, dbGetAllStrict } from "./storage";
import { dxdb } from "./dexie-db";
import { acquirePersistedLocalRecordKey } from "./local-record-key-store";

export const LOCAL_PROFILE_LEGACY_ID = "my-profile-v1";
export const LOCAL_PROFILE_ENCRYPTED_ID = "my-profile-sealed-v1";
export const ENCRYPTED_CHUNK_MIME = "application/x-trivo-encrypted-chunk";

/**
 * New chat-summary ciphertext has the same legacy contacts primary key.
 * A lost Keystore wrapper must not bootstrap a fresh master key while ANY
 * sealed chat-list row survives, including a damaged/unsupported envelope.
 */
export function protectedContactsContainCiphertext(rows: readonly unknown[]): boolean {
  return rows.some((row) => row !== null && typeof row === "object" &&
    !Array.isArray(row) && ("sealed" in row || "kind" in row));
}

let current: Promise<CryptoKey> | null = null;

export async function protectedStorageHasNoCiphertext(): Promise<boolean> {
  const [profile, chunks, chatSummaries] = await Promise.all([
    dbGetStrict<unknown>("settings", LOCAL_PROFILE_ENCRYPTED_ID),
    dxdb.partial_chunks.filter((row) =>
      row.encrypted === 1 || row.data.type === ENCRYPTED_CHUNK_MIME).count(),
    dbGetAllStrict<unknown>("contacts"),
  ]);
  // Even a corrupt/unknown envelope at this key means a key may be needed.
  // The profile must never be silently reinitialized if its key is lost.
  return profile === undefined && chunks === 0 &&
    !protectedContactsContainCiphertext(chatSummaries);
}

/** Reuse the native Keystore unlock inside this running app. */
export function acquireLocalDataKey(): Promise<CryptoKey> {
  if (!current) {
    current = acquirePersistedLocalRecordKey(protectedStorageHasNoCiphertext)
      .catch((error: unknown) => {
        current = null;
        throw error;
      });
  }
  return current;
}

/** Called after an explicit full-data wipe, never on ordinary navigation. */
export function forgetCachedLocalDataKey(): void {
  current = null;
}
