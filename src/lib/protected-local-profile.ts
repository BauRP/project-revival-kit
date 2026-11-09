/**
 * Android-only encrypted local profile storage.
 *
 * Legacy key "my-profile-v1" contains plaintext. Migration commits and
 * authenticates a Keystore-backed ciphertext under a separate key BEFORE
 * erasing that old value. If the app dies after the first write, the sealed
 * value wins on resume and the remaining plaintext is removed on next load.
 * Browser preview keeps the original legacy key/behavior.
 */
import type { UserProfile } from "./profile";
import { dbDeleteIfUnchangedStrict, dbGetStrict, dbPutStrict } from "./storage";
import { platform } from "./platform";
import {
  LOCAL_PROFILE_ENCRYPTED_ID, LOCAL_PROFILE_LEGACY_ID, acquireLocalDataKey,
} from "./protected-record-inventory";
import {
  sealLocalRecord, openLocalRecord, type SealedLocalRecord,
} from "./local-record-crypto";
import { validateEditableProfile } from "./profile-policy";

const VERSION = 1 as const;
const ENCRYPTED_TABLE = "settings";

export interface SealedLocalProfile {
  version: typeof VERSION;
  sealed: SealedLocalRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Never fall back to the plaintext legacy key for corrupt sealed metadata. */
export function parseSealedLocalProfile(value: unknown): SealedLocalProfile {
  if (!isRecord(value) || value.version !== VERSION ||
      !isRecord(value.sealed) ||
      value.sealed.version !== VERSION ||
      value.sealed.algorithm !== "AES-256-GCM" ||
      typeof value.sealed.nonce !== "string" ||
      typeof value.sealed.ciphertext !== "string")
    throw new Error("Invalid encrypted local profile record");
  return value as unknown as SealedLocalProfile;
}

/**
 * Never silently replace a malformed or foreign legacy profile with an empty
 * profile during migration. A saved different onion identity must be resolved
 * by explicit account recovery, not normalized to the current identity.
 */
export function assertStoredProfileOwner(value: unknown, expectedUserId: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error("Saved local profile is malformed");
  if (typeof value.userId !== "string" || !value.userId ||
      value.userId !== expectedUserId)
    throw new Error("Saved local profile belongs to another identity");
  if (typeof value.name !== "string" ||
      typeof value.customStatus !== "string" ||
      (value.avatar !== null && typeof value.avatar !== "string") ||
      !Number.isSafeInteger(value.updatedAt) ||
      (value.updatedAt as number) < 0)
    throw new Error("Saved local profile is malformed");
  validateEditableProfile(value as unknown as UserProfile);
}

export async function sealLocalProfile(
  key: CryptoKey, profile: UserProfile,
): Promise<SealedLocalProfile> {
  validateEditableProfile(profile);
  if (!profile.userId || !Number.isSafeInteger(profile.updatedAt) ||
      profile.updatedAt < 0)
    throw new Error("Invalid profile to encrypt");
  const sealed = await sealLocalRecord(key, ENCRYPTED_TABLE,
    LOCAL_PROFILE_ENCRYPTED_ID, JSON.stringify(profile));
  return { version: VERSION, sealed };
}

export async function openLocalProfile(
  key: CryptoKey, value: unknown,
): Promise<UserProfile> {
  const saved = parseSealedLocalProfile(value);
  const json = await openLocalRecord(key, ENCRYPTED_TABLE,
    LOCAL_PROFILE_ENCRYPTED_ID, saved.sealed);
  let result: unknown;
  try { result = JSON.parse(json); }
  catch { throw new Error("Invalid authenticated local profile JSON"); }
  if (!isRecord(result) || typeof result.userId !== "string" ||
      !result.userId || !Number.isSafeInteger(result.updatedAt) ||
      (result.updatedAt as number) < 0)
    throw new Error("Invalid authenticated local profile");
  validateEditableProfile(result as unknown as UserProfile);
  return result as unknown as UserProfile;
}

/**
 * A successful IndexedDB request is not proof of durable replacement.
 * Verify ciphertext from a committed read before deleting old plaintext.
 */
export async function commitSealedProfile(
  expected: UserProfile, encrypted: SealedLocalProfile,
  io: {
    write(value: SealedLocalProfile): Promise<void>;
    read(): Promise<unknown>;
    decrypt(value: unknown): Promise<UserProfile>;
    eraseLegacy(): Promise<void>;
  },
): Promise<void> {
  await io.write(encrypted);
  const verified = await io.decrypt(await io.read());
  if (JSON.stringify(verified) !== JSON.stringify(expected))
    throw new Error("Encrypted profile verification mismatch");
  await io.eraseLegacy();
}

/** Keep the native profile private; web preview has no Android Keystore. */
/**
 * Protect the still-readable legacy copy until both the ciphertext integrity
 * and its binding to the current identity have been verified. Cleanup is
 * retryable if the app is interrupted after decrypting.
 */
export async function openAndRetireLegacyProfile(
  encrypted: unknown,
  currentUserId: string,
  key: CryptoKey,
  oldRead: () => Promise<unknown>,
  oldErase: (expected: unknown) => Promise<void>,
): Promise<UserProfile> {
  const opened = await openLocalProfile(key, encrypted);
  assertStoredProfileOwner(opened, currentUserId);
  const old = await oldRead();
  if (old !== undefined) {
    // Do not destroy a foreign, damaged or concurrently replaced legacy copy.
    assertStoredProfileOwner(old, currentUserId);
    await oldErase(old);
  }
  return opened;
}

export async function readStoredLocalProfile(currentUserId: string): Promise<{
  value: unknown; migrateLegacy: boolean;
}> {
  if (platform() !== "android")
    return { value: await dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID),
      migrateLegacy: false };
  const ciphertext = await dbGetStrict<unknown>("settings", LOCAL_PROFILE_ENCRYPTED_ID);
  if (ciphertext !== undefined) {
    const key = await acquireLocalDataKey();
    // On crash after writing ciphertext, the sealed copy is authoritative
    // ONLY if its authenticated identity matches the currently opened account.
    // Do not erase the legacy record before proving both conditions.
    const opened = await openAndRetireLegacyProfile(
      ciphertext, currentUserId, key,
      () => dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID),
      (expected) => dbDeleteIfUnchangedStrict("settings", LOCAL_PROFILE_LEGACY_ID, expected),
    );
    return { value: opened, migrateLegacy: false };
  }
  const old = await dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID);
  return { value: old, migrateLegacy: old !== undefined };
}

/** Shared guard for new edits, legacy migrations and crash-resume paths. */
export async function assertExistingLocalProfileIdentity(
  userId: string, key: CryptoKey, legacy: unknown, sealed: unknown,
): Promise<void> {
  assertStoredProfileOwner(legacy, userId);
  if (sealed !== undefined) {
    assertStoredProfileOwner(await openLocalProfile(key, sealed), userId);
  }
}

export async function saveStoredLocalProfile(profile: UserProfile): Promise<void> {
  if (platform() !== "android") {
    await dbPutStrict("settings", LOCAL_PROFILE_LEGACY_ID, profile);
    return;
  }
  const key = await acquireLocalDataKey();
  // Check BOTH copies before replacement. A foreign or corrupt sealed profile
  // must never be overwritten; a foreign legacy profile must never be erased.
  const [legacy, previousSealed] = await Promise.all([
    dbGetStrict<unknown>("settings", LOCAL_PROFILE_LEGACY_ID),
    dbGetStrict<unknown>("settings", LOCAL_PROFILE_ENCRYPTED_ID),
  ]);
  await assertExistingLocalProfileIdentity(profile.userId, key, legacy, previousSealed);
  const encrypted = await sealLocalProfile(key, profile);
  await commitSealedProfile(profile, encrypted, {
    write: (value) => dbPutStrict("settings", LOCAL_PROFILE_ENCRYPTED_ID, value),
    read: () => dbGetStrict("settings", LOCAL_PROFILE_ENCRYPTED_ID),
    decrypt: (value) => openLocalProfile(key, value),
    eraseLegacy: () => legacy === undefined ? Promise.resolve() :
      dbDeleteIfUnchangedStrict("settings", LOCAL_PROFILE_LEGACY_ID, legacy),
  });
}
