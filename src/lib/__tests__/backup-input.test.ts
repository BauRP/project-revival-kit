import { describe, it, expect } from "vitest";
import { decryptBackupV2 } from "../backup-crypto";
import { assertBackupFileSize, MAX_BACKUP_FILE_BYTES } from "../backup-input-policy";
describe("untrusted web backup memory preflight", () => {
  it("accepts the existing archive size limit including its boundary", () => {
    expect(() => assertBackupFileSize(0)).not.toThrow();
    expect(() => assertBackupFileSize(MAX_BACKUP_FILE_BYTES)).not.toThrow();
  });
  it("rejects oversized, fractional and invalid file sizes before reading", () => {
    for (const size of [MAX_BACKUP_FILE_BYTES + 1, -1, NaN, Infinity, 1.5]) {
      expect(() => assertBackupFileSize(size)).toThrow(/Backup file/);
    }
  });
});
describe("encrypted backup input validation", () => {
  it("rejects invalid encodings before key derivation", async () => {
    const bad = {magic:"TRIVO-BACKUP-V2",kdf:"PBKDF2-SHA256",iterations:600000,
      salt:"invalid_=",iv:"AQID",cipher:"AES-256-GCM",ciphertext:"AQID",createdAt:1} as const;
    await expect(decryptBackupV2(bad,"long-enough-passphrase")).rejects.toThrow();
  });
});
describe("encrypted backup envelope timestamp",()=>{
  it("rejects implausible future metadata without decrypting",async()=>{
    const bad={magic:"TRIVO-BACKUP-V2",kdf:"PBKDF2-SHA256",iterations:600000,
      salt:"AQID",iv:"AQID",cipher:"AES-256-GCM",ciphertext:"AQID",
      createdAt:Number.MAX_SAFE_INTEGER} as const;
    await expect(decryptBackupV2(bad,"long-enough-passphrase")).rejects.toThrow("Unsupported");
  });
});

import { validateLegacyBackupEnvelope } from "../legacy-backup-policy";
describe("read-only legacy backup input bounds", () => {
  const valid = {
    magic: "TRIVO-BACKUP-V1" as const,
    createdAt: 1000,
    nonce: "A".repeat(32),
    ciphertext: "AQID".repeat(6),
  };
  it("accepts a structurally valid historical envelope for later authentication", () => {
    expect(validateLegacyBackupEnvelope(valid, 1000).magic).toBe("TRIVO-BACKUP-V1");
  });
  it("rejects oversized, invalid base64 and future-dated legacy input before decoding", () => {
    expect(() => validateLegacyBackupEnvelope({ ...valid, nonce: "?" }, 1000)).toThrow();
    expect(() => validateLegacyBackupEnvelope({ ...valid, ciphertext: "%%%" }, 1000)).toThrow();
    expect(() => validateLegacyBackupEnvelope({ ...valid, createdAt: Number.MAX_SAFE_INTEGER }, 1000)).toThrow();
    expect(() => validateLegacyBackupEnvelope({ ...valid, ciphertext: "A".repeat(1_001) }, 1000)).toThrow();
  });
});
