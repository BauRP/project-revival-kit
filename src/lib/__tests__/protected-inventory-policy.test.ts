import { describe, expect, it } from "vitest";
import {
  isProtectedLegacyContactRow,
  protectedContactsContainCiphertext,
} from "../protected-record-inventory";
import { dbHasKeyPrefixStrict } from "../storage";

describe("Android Keystore inventory recognizes all protected contacts", () => {
  it("identifies encrypted legacy rows even with damaged ciphertext metadata", () => {
    for (const record of [
      { sealed: {} },
      { kind: "future-version" },
      { sealed: null, kind: "unknown" },
    ]) {
      expect(isProtectedLegacyContactRow(record)).toBe(true);
      expect(protectedContactsContainCiphertext([record])).toBe(true);
    }
  });
  it("does not mistake ordinary unprotected contacts for encrypted records", () => {
    const contacts = [undefined, null, { displayName: "Friend" }, "hello", 42, []];
    for (const row of contacts) expect(isProtectedLegacyContactRow(row)).toBe(false);
    expect(protectedContactsContainCiphertext(contacts)).toBe(false);
  });
  it("never scans for an unsafe or impossible encrypted settings prefix", async () => {
    for (const prefix of ["", "x".repeat(129), "bad\nkey"]) {
      await expect(dbHasKeyPrefixStrict("settings", prefix)).rejects.toThrow(/Invalid/);
    }
  });
});
