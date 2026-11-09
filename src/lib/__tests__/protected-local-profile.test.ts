import { describe, expect, it, vi } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  sealLocalProfile, openLocalProfile, parseSealedLocalProfile, commitSealedProfile,
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
    await expect(commitSealedProfile(profile,ciphertext,{
      write: async () => {throw new Error("disk full");},
      read: async () => ciphertext,
      decrypt: (x)=>openLocalProfile(await key(15),x),
      eraseLegacy: erase,
    })).rejects.toThrow("disk full");
    expect(erase).not.toHaveBeenCalled();
  });
});
