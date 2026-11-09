import { describe, expect, it, vi } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  sealLocalProfile, openLocalProfile, parseSealedLocalProfile, commitSealedProfile,
  openAndRetireLegacyProfile, assertExistingLocalProfileIdentity,
} from "../protected-local-profile";
import type { UserProfile } from "../profile";

const identity = "a".repeat(56) + ".onion";
const saved = (): UserProfile => ({
  userId: identity, name: "Құпия профиль", avatar: null,
  status: "custom", customStatus: "Офлайн", updatedAt: 1777777777,
});
const key = (v: number) => importLocalRecordKey(new Uint8Array(32).fill(v));

describe("Android local profile AES-GCM confidentiality", () => {
  it("does not store name, avatar or status as plaintext and restores all fields", async () => {
    const k = await key(11);
    const profile = saved();
    const envelope = await sealLocalProfile(k, profile);
    expect(JSON.stringify(envelope)).not.toContain(profile.name);
    expect(JSON.stringify(envelope)).not.toContain(profile.customStatus);
    expect(JSON.stringify(envelope)).not.toContain(profile.userId);
    expect(await openLocalProfile(k, envelope)).toEqual(profile);
  });
  it("refuses key loss, tampering, unsupported versions and cross-record substitution", async () => {
    const encrypted = await sealLocalProfile(await key(12), saved());
    await expect(openLocalProfile(await key(13), encrypted)).rejects.toThrow();
    await expect(openLocalProfile(await key(12), {
      ...encrypted, version: 2,
    })).rejects.toThrow("Invalid encrypted local profile");
    await expect(openLocalProfile(await key(12), {
      ...encrypted, sealed: {...encrypted.sealed, nonce:"AAAAAAAAAAAAAAAA"},
    })).rejects.toThrow();
    expect(() => parseSealedLocalProfile({name:"legacy"})).toThrow();
  });
  it("never destroys legacy plaintext until committed ciphertext is re-opened", async () => {
    const profile = saved();
    const k = await key(14);
    const ciphertext = await sealLocalProfile(k, profile);
    let disk: unknown;
    const erased = vi.fn(async () => undefined);
    const write = vi.fn(async (next: unknown) => { disk = next; });
    const read = async () => disk;
    const decrypt = (record: unknown) => openLocalProfile(k,record);
    await commitSealedProfile(profile,ciphertext,{
      write,read,decrypt,eraseLegacy:erased,
    });
    expect(write).toHaveBeenCalledOnce();
    expect(erased).toHaveBeenCalledOnce();
    erased.mockClear();
    await expect(commitSealedProfile(profile,ciphertext,{
      write: async () => undefined,
      read: async () => undefined,
      decrypt,eraseLegacy:erased,
    })).rejects.toThrow();
    expect(erased).not.toHaveBeenCalled();
  });
  it("keeps the old profile if storage commit fails and retry can resume", async () => {
    const profile = saved(),ciphertext = await sealLocalProfile(await key(15),profile);
    const erase = vi.fn(async () => undefined);
    const sameKey = await key(15);
    await expect(commitSealedProfile(profile,ciphertext,{
      write: async () => {throw new Error("disk full");},
      read: async () => ciphertext,
      decrypt: (x)=>openLocalProfile(sameKey,x),
      eraseLegacy: erase,
    })).rejects.toThrow("disk full");
    expect(erase).not.toHaveBeenCalled();
  });
});

import { assertStoredProfileOwner } from "../protected-local-profile";

describe("profile migration must preserve legacy identity and data on failure", () => {
  it("accepts only a well-formed profile for the same Tor identity", () => {
    expect(() => assertStoredProfileOwner(saved(),identity)).not.toThrow();
    expect(() => assertStoredProfileOwner(undefined,identity)).not.toThrow();
  });
  it("rejects a foreign identity before any migration/write occurs", () => {
    expect(() => assertStoredProfileOwner({...saved(),userId:"foreign.onion"},identity))
      .toThrow("another identity");
  });
  it("rejects corrupt legacy plaintext instead of replacing it with an empty profile", () => {
    expect(() => assertStoredProfileOwner({name:"old content"},identity))
      .toThrow("another identity");
    expect(() => assertStoredProfileOwner({...saved(),name:17},identity))
      .toThrow("malformed");
    expect(() => assertStoredProfileOwner({...saved(),updatedAt:NaN},identity))
      .toThrow("malformed");
  });
});

describe("identity-verified encrypted profile recovery before deleting legacy", () => {
  it("retains old plaintext when ciphertext belongs to a different identity", async () => {
    const original = saved();
    const ciphertext = await sealLocalProfile(await key(20),original);
    const erase = vi.fn(async () => undefined);
    await expect(openAndRetireLegacyProfile(
      ciphertext,"different-identity.onion",await key(20),
      async () => original,erase,
    )).rejects.toThrow("another identity");
    expect(erase).not.toHaveBeenCalled();
  });
  it("retains old plaintext on authentication failure", async () => {
    const original = saved();
    const ciphertext = await sealLocalProfile(await key(21),original);
    const erase = vi.fn(async () => undefined);
    await expect(openAndRetireLegacyProfile(
      ciphertext,identity,await key(22),
      async () => original,erase,
    )).rejects.toThrow();
    expect(erase).not.toHaveBeenCalled();
  });
  it("does not erase legacy data belonging to a different identity even when sealed copy is valid", async () => {
    const encrypted = await sealLocalProfile(await key(24), saved());
    const erase = vi.fn(async () => undefined);
    await expect(openAndRetireLegacyProfile(
      encrypted, identity, await key(24),
      async () => ({ ...saved(), userId: "other.onion" }), erase,
    )).rejects.toThrow("another identity");
    expect(erase).not.toHaveBeenCalled();
  });
  it("retains the old profile when an atomic compare-and-delete detects a concurrent update", async () => {
    const encrypted = await sealLocalProfile(await key(25), saved());
    const erase = vi.fn(async (_expected: unknown) => {
      throw new Error("Legacy profile changed during encrypted migration");
    });
    await expect(openAndRetireLegacyProfile(
      encrypted, identity, await key(25), async () => saved(), erase,
    )).rejects.toThrow("changed during encrypted migration");
    expect(erase).toHaveBeenCalledWith(saved());
  });
  it("refuses to overwrite a foreign, tampered or unreadable encrypted profile on save", async () => {
    const valid = await sealLocalProfile(await key(26), saved());
    const sameKey = await key(26);
    await expect(assertExistingLocalProfileIdentity(
      identity, sameKey, saved(), valid,
    )).resolves.toBeUndefined();
    await expect(assertExistingLocalProfileIdentity(
      identity, sameKey, { ...saved(), userId: "other.onion" }, valid,
    )).rejects.toThrow("another identity");
    const foreign = await sealLocalProfile(sameKey, { ...saved(), userId: "other.onion" });
    await expect(assertExistingLocalProfileIdentity(
      identity, sameKey, undefined, foreign,
    )).rejects.toThrow("another identity");
    await expect(assertExistingLocalProfileIdentity(
      identity, sameKey, undefined, { ...valid, sealed: { ...valid.sealed, nonce: "bad" } },
    )).rejects.toThrow();
  });
  it("deletes old plaintext only after decrypting and verifying same identity", async () => {
    const original = saved();
    const ciphertext = await sealLocalProfile(await key(23),original);
    const erase = vi.fn(async () => undefined);
    expect(await openAndRetireLegacyProfile(
      ciphertext,identity,await key(23),
      async () => original,erase,
    )).toEqual(original);
    expect(erase).toHaveBeenCalledOnce();
    const noOld = vi.fn(async () => undefined);
    expect(await openAndRetireLegacyProfile(
      ciphertext,identity,await key(23),
      async () => undefined,noOld,
    )).toEqual(original);
    expect(noOld).not.toHaveBeenCalled();
  });
});
