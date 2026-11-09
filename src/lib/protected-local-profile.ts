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
import { dbDelete, dbGetStrict, dbPutStrict } from "./storage";
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
export async function readStoredLocalProfile(): Promise<{
  value: unknown; migrateLegacy: boolean;
}> {
  if (platform() !== "android")
    return { value: await dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID),
      migrateLegacy: false };
  const ciphertext = await dbGetStrict<unknown>("settings", LOCAL_PROFILE_ENCRYPTED_ID);
  if (ciphertext !== undefined) {
    const key = await acquireLocalDataKey();
    const opened = await openLocalProfile(key, ciphertext);
    // On crash after writing ciphertext, the sealed copy is authoritative.
    // Remove any leftover legacy plaintext only after verified decryption.
    const old = await dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID);
    if (old !== undefined) await dbDelete("settings", LOCAL_PROFILE_LEGACY_ID);
    return { value: opened, migrateLegacy: false };
  }
  const old = await dbGetStrict("settings", LOCAL_PROFILE_LEGACY_ID);
  return { value: old, migrateLegacy: old !== undefined };
}

export async function saveStoredLocalProfile(profile: UserProfile): Promise<void> {
  if (platform() !== "android") {
    await dbPutStrict("settings", LOCAL_PROFILE_LEGACY_ID, profile);
    return;
  }
  const key = await acquireLocalDataKey();
  const encrypted = await sealLocalProfile(key, profile);
  await commitSealedProfile(profile, encrypted, {
    write: (value) => dbPutStrict("settings", LOCAL_PROFILE_ENCRYPTED_ID, value),
    read: () => dbGetStrict("settings", LOCAL_PROFILE_ENCRYPTED_ID),
    decrypt: (value) => openLocalProfile(key, value),
    eraseLegacy: () => dbDelete("settings", LOCAL_PROFILE_LEGACY_ID),
  });
}
