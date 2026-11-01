import { describe, it, expect } from "vitest";
import { decryptBackupV2 } from "../backup-crypto";
describe("encrypted backup input validation", () => {
  it("rejects invalid encodings before key derivation", async () => {
    const bad = {magic:"TRIVO-BACKUP-V2",kdf:"PBKDF2-SHA256",iterations:600000,
      salt:"invalid_=",iv:"AQID",cipher:"AES-256-GCM",ciphertext:"AQID",createdAt:1} as const;
    await expect(decryptBackupV2(bad,"long-enough-passphrase")).rejects.toThrow();
  });
});