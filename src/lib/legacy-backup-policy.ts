/**
 * Legacy V1 archives use an older password KDF. They are READ ONLY.
 * Bound the untrusted envelope before Base64 decoding and NaCl processing.
 * No JSON shape checks or KDF can make legacy encryption equivalent to V2.
 */
const MAX_ENCODED_LEGACY_CIPHER = 240 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface LegacyBackupEnvelope {
  magic: "TRIVO-BACKUP-V1";
  nonce: string;
  ciphertext: string;
  createdAt: number;
}

export function validateLegacyBackupEnvelope(raw: unknown, now = Date.now()): LegacyBackupEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid legacy backup envelope");
  const r = raw as Record<string, unknown>;
  if (r.magic !== "TRIVO-BACKUP-V1" ||
      !Number.isSafeInteger(r.createdAt) ||
      (r.createdAt as number) <= 0 || (r.createdAt as number) > now + 600_000 ||
      typeof r.nonce !== "string" || r.nonce.length !== 32 || !BASE64.test(r.nonce) ||
      typeof r.ciphertext !== "string" || r.ciphertext.length < 24 ||
      r.ciphertext.length > MAX_ENCODED_LEGACY_CIPHER ||
      r.ciphertext.length % 4 !== 0 || !BASE64.test(r.ciphertext))
    throw new Error("Invalid or oversized legacy backup");
  return r as unknown as LegacyBackupEnvelope;
}
