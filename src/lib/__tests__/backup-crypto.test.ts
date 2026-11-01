import { describe, expect, it } from "vitest";
import { encryptBackupV2, decryptBackupV2 } from "../backup-crypto";

describe("portable offline backup V2", () => {
  const pass = "unique private recovery phrase 2026";
  it("encrypts and decrypts complete UTF-8 data", async () => {
    const source = JSON.stringify({ name: "Заметки", messages: ["Привет", "Сәлем", "こんにちは"] });
    const sealed = await encryptBackupV2(source, pass);
    expect(sealed.ciphertext).not.toContain("Привет");
    expect(await decryptBackupV2(sealed, pass)).toBe(source);
  });
  it("uses independent nonces and salts", async () => {
    const one = await encryptBackupV2("hello", pass);
    const two = await encryptBackupV2("hello", pass);
    expect(one.salt).not.toBe(two.salt);
    expect(one.iv).not.toBe(two.iv);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });
  it("rejects a wrong password, damaged ciphertext and weak passwords", async () => {
    const one = await encryptBackupV2("secret", pass);
    await expect(decryptBackupV2(one, "another secure recovery phrase")).rejects.toThrow();
    const altered = { ...one, ciphertext: one.ciphertext.slice(0, -4) + "AAAA" };
    await expect(decryptBackupV2(altered, pass)).rejects.toThrow();
    await expect(encryptBackupV2("secret", "short")).rejects.toThrow();
  });
});
