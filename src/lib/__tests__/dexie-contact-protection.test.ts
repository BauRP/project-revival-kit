import { describe, expect, it } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  sealDexieContact, openDexieContact, hasProtectedDexieContactName,
  sameStoredContact,
} from "../dexie-contact-protection";
import type { ContactRecord } from "../dexie-db";

const peer = "a".repeat(56) + ".onion";
const contact = (): ContactRecord => ({
  onion: peer, displayName: "Секретное имя", addedAt: 100,
  lastSeen: 123,
});
const key = (v: number) => importLocalRecordKey(new Uint8Array(32).fill(v));

describe("Android Dexie contacts directory AES-GCM", () => {
  it("hides the contact name while preserving required routing and presence indexes", async () => {
    const k = await key(61);
    const encrypted = await sealDexieContact(k, contact());
    expect(encrypted.onion).toBe(peer);
    expect(encrypted.lastSeen).toBe(123);
    expect(encrypted.addedAt).toBe(100);
    expect(encrypted.displayName).toBeUndefined();
    expect(JSON.stringify(encrypted)).not.toContain("Секретное имя");
    expect(hasProtectedDexieContactName(encrypted)).toBe(true);
    expect(await openDexieContact(k, encrypted)).toEqual(contact());
  });
  it("detects missing keys, ciphertext tampering, row swapping, and unknown envelopes", async () => {
    const encrypted = await sealDexieContact(await key(62), contact());
    await expect(openDexieContact(await key(63), encrypted)).rejects.toThrow();
    await expect(openDexieContact(await key(62), {
      ...encrypted, onion: "b".repeat(56) + ".onion",
    })).rejects.toThrow();
    await expect(openDexieContact(await key(62), {
      ...encrypted, protectedName: { ...encrypted.protectedName!, kind: "future-format" as never },
    })).rejects.toThrow("Invalid protected");
    await expect(openDexieContact(await key(62), {
      ...encrypted, displayName: "accidental leaked copy",
    })).rejects.toThrow("retains plaintext");
  });
  it("reads legacy records for safe migration and rejects malformed names", async () => {
    expect(await openDexieContact(await key(64), contact())).toEqual(contact());
    await expect(sealDexieContact(await key(64), {
      ...contact(), displayName: "x".repeat(513),
    })).rejects.toThrow("Invalid local contact name");
    await expect(openDexieContact(await key(64), {
      ...contact(), onion: "",
    })).rejects.toThrow("identity");
  });
  it("preserves no-name records without fake ciphertext", async () => {
    const original = { onion: peer, addedAt: 12 };
    const secured = await sealDexieContact(await key(65), original);
    expect(secured).toEqual(original);
    expect(hasProtectedDexieContactName(secured)).toBe(false);
  });
  it("never confuses changed/stale records for the same saved snapshot", async () => {
    const k = await key(66);
    const first = await sealDexieContact(k, contact());
    const second = await sealDexieContact(k, contact());
    expect(sameStoredContact(first, first)).toBe(true);
    expect(sameStoredContact(first, second)).toBe(false);
    expect(sameStoredContact(first, { ...first, lastSeen: 999 })).toBe(false);
  });
});
