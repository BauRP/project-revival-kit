/** Android AES-GCM storage for authenticated remote profile lifecycle data.
 * Indexed metadata (key/chatKey/messageId/updatedAt) stays available.
 * Portable V3 backups must export decrypted fields under backup-password crypto.
 */
import { platform } from "./platform";
import { sealLocalRecord, openLocalRecord, type SealedLocalRecord } from "./local-record-crypto";
import { validateSharedProfile, type SharedProfile } from "./profile-wire";

export const SEALED_REMOTE_PROFILE_KIND = "trivo-remote-profile-sealed-v1" as const;
const TABLE = "dexie_remote_profile";
export interface SealedRemoteProfile {
  kind: typeof SEALED_REMOTE_PROFILE_KIND;
  sealed: SealedLocalRecord;
}
export function looksLikeSealedRemoteProfile(data: unknown): boolean {
  return !!data && typeof data === "object" && !Array.isArray(data) &&
    ("sealed" in data || "kind" in data);
}
export function hasEncryptedRemoteProfileRow(row: unknown): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  return record.chatKey === "remote-profile" &&
    looksLikeSealedRemoteProfile(record.data);
}
export async function remoteProfileDataKey(): Promise<CryptoKey | null> {
  if (platform() !== "android") return null;
  const { acquireLocalDataKey } = await import("./protected-record-inventory");
  return acquireLocalDataKey();
}
export async function sealRemoteProfile(
  key: CryptoKey, profile: SharedProfile,
): Promise<SealedRemoteProfile> {
  const valid = validateSharedProfile(profile, profile.userId);
  if (!valid) throw new Error("Invalid remote profile to encrypt");
  return {
    kind: SEALED_REMOTE_PROFILE_KIND,
    sealed: await sealLocalRecord(key, TABLE, profile.userId, JSON.stringify(valid)),
  };
}
export async function openRemoteProfile(
  key: CryptoKey | null, sender: string, data: unknown,
): Promise<SharedProfile> {
  let decoded: unknown = data;
  if (looksLikeSealedRemoteProfile(data)) {
    if (!key) throw new Error("Encrypted remote profile requires Android Keystore");
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        (data as Partial<SealedRemoteProfile>).kind !== SEALED_REMOTE_PROFILE_KIND ||
        !(data as Partial<SealedRemoteProfile>).sealed)
      throw new Error("Invalid protected remote profile envelope");
    const plaintext = await openLocalRecord(
      key, TABLE, sender, (data as SealedRemoteProfile).sealed,
    );
    try { decoded = JSON.parse(plaintext) as unknown; }
    catch { throw new Error("Invalid authenticated remote profile JSON"); }
  }
  const profile = validateSharedProfile(decoded, sender);
  if (!profile) throw new Error("Invalid authenticated remote profile content");
  return profile;
}
export function sameRemoteProfileRow(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
