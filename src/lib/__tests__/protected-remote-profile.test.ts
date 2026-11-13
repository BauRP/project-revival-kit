import { describe, expect, it } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import { sealRemoteProfile, openRemoteProfile, looksLikeSealedRemoteProfile,
  hasEncryptedRemoteProfileRow, sameRemoteProfileRow } from "../protected-remote-profile";
import type { SharedProfile } from "../profile-wire";

const sender = "a".repeat(56) + ".onion";
const data = (): SharedProfile => ({
  userId: sender, name: "Секретное имя", avatar: null,
  status: "custom", customStatus: "Личный статус", updatedAt: 1777777777,
});
const key = (n: number) => importLocalRecordKey(new Uint8Array(32).fill(n));

describe("Android encrypted remote-profile lifecycle", () => {
  it("hides name and status while retaining indexed lifecycle metadata", async () => {
    const profile = data();
    const k = await key(81);
    const sealed = await sealRemoteProfile(k, profile);
    const row = { key:"profile::"+sender, chatKey:"remote-profile", messageId:sender,
      updatedAt:profile.updatedAt, data:{...sealed} };
    expect(JSON.stringify(row)).not.toContain(profile.name);
    expect(JSON.stringify(row)).not.toContain(profile.customStatus);
    expect(hasEncryptedRemoteProfileRow(row)).toBe(true);
    expect(await openRemoteProfile(k, sender, row.data)).toEqual(profile);
  });
  it("authenticates the Tor sender, encryption key and envelope", async () => {
    const saved = await sealRemoteProfile(await key(82), data());
    await expect(openRemoteProfile(await key(83), sender, saved)).rejects.toThrow();
    await expect(openRemoteProfile(await key(82), "b".repeat(56)+".onion", saved))
      .rejects.toThrow();
    await expect(openRemoteProfile(null, sender, saved)).rejects.toThrow("Keystore");
    await expect(openRemoteProfile(await key(82), sender, {...saved,kind:"future"}))
      .rejects.toThrow("envelope");
    await expect(openRemoteProfile(await key(82), sender, {...saved,
      sealed:{...saved.sealed, ciphertext:"wrong!"}})).rejects.toThrow();
  });
  it("reads legacy plaintext but rejects identity mismatch and unsafe fields", async () => {
    expect(await openRemoteProfile(null, sender, data())).toEqual(data());
    await expect(openRemoteProfile(null, sender, {...data(), userId:"other"})).rejects.toThrow();
    await expect(openRemoteProfile(null, sender, {...data(), avatar:"https://evil.test"}))
      .rejects.toThrow();
    await expect(openRemoteProfile(null, sender, {kind:"future", name:"plaintext"}))
      .rejects.toThrow("Keystore");
  });
  it("detects unsupported ciphertext before new master-key bootstrap", () => {
    expect(hasEncryptedRemoteProfileRow({
      chatKey:"remote-profile",data:{kind:"future"},
    })).toBe(true);
    expect(hasEncryptedRemoteProfileRow({chatKey:"remote-profile",data:data()}))
      .toBe(false);
    expect(looksLikeSealedRemoteProfile({sealed:{invalid:true}})).toBe(true);
  });
  it("detects a changed row during safe legacy migration", () => {
    const old = {key:"profile::peer",data:data(),updatedAt:1};
    expect(sameRemoteProfileRow(old,old)).toBe(true);
    expect(sameRemoteProfileRow(old,{...old,updatedAt:2})).toBe(false);
  });
});
