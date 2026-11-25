import { describe, expect, it } from "vitest";
import {
  validatePortableChatPreferences, mergePortableChatPreferenceState,
} from "../backup-chat-preferences";
import { makePortableBackupPackage, readPortableBackupPayload } from "../backup-package";
import type { IdentityKeys } from "../crypto";

const dump = () => ({
  schemaVersion: 3 as const, createdAt: 1000, contacts: [], messages: [],
  outbox: [], lifecycle: [], blobs: [],
});
const identity: IdentityKeys = {
  createdAt: 1000,
  signing: { publicKey: "signing-key", secretKey: "secret" },
  exchange: { publicKey: "exchange-key", secretKey: "secret" },
};

describe("password-encrypted portable chat preferences", () => {
  it("roundtrips block, disappearing, mute and attachment defaults with existing identity", () => {
    const settings = [
      { chatId: "friend", state: { blocked: true, oneTimeDefault: true,
        disappearingDuration: "1h" as const, mutedUntil: 1800000 } },
      { chatId: "another", state: { favorite: true, archived: true, silentDefault: true } },
    ];
    const pack = makePortableBackupPackage(identity, dump(), settings);
    expect(readPortableBackupPayload(JSON.parse(JSON.stringify(pack)))).toEqual({
      dump: dump(), identity, chatPreferences: settings,
    });
  });

  it("restores old packages and old database-only archives with no preferences", () => {
    const oldPackage = makePortableBackupPackage(identity, dump());
    expect(readPortableBackupPayload(oldPackage).chatPreferences).toEqual([]);
    expect(readPortableBackupPayload(dump()).chatPreferences).toEqual([]);
  });

  it("keeps blocked/one-time enabled on existing device despite older backup", () => {
    const local = { blocked: true, oneTimeDefault: true, favorite: false };
    const backup = { blocked: false, oneTimeDefault: false,
      disappearingDuration: "6h" as const, silentDefault: true };
    expect(mergePortableChatPreferenceState(local, backup)).toEqual({
      blocked: true, oneTimeDefault: true, favorite: false,
      disappearingDuration: "6h", silentDefault: true,
    });
  });

  it("never silently unblocks a peer but restores blocked if local was unblocked", () => {
    expect(mergePortableChatPreferenceState({ blocked: false }, { blocked: true }).blocked)
      .toBe(true);
    expect(mergePortableChatPreferenceState({}, { blocked: true }).blocked).toBe(true);
  });

  it("refuses duplicate identities, oversized or malformed portable state", () => {
    const good = {chatId:"peer",state:{blocked:true}};
    for (const bad of [
      [good,good],
      [{ chatId:"",state:{} }],
      [{ chatId:"sealed-peer",state:{} }],
      [{ chatId:"peer\\nother",state:{} }],
      [{ chatId:"peer",state:{blocked:"true"} }],
      [{ chatId:"peer",state:{disappearingDuration:"2years"} }],
      [{ chatId:"peer",state:{__protoKey:"unexpected"} }],
      [{ chatId:"peer",state:[] }],
      new Array(20001).fill(good),
    ]) {
      expect(() => validatePortableChatPreferences(bad)).toThrow();
    }
  });

  it("rejects a forged extension even inside an authenticated backup package", () => {
    const p = makePortableBackupPackage(identity, dump());
    expect(() => readPortableBackupPayload({
      ...p, chatPreferences: [{ chatId: "peer", state: { blocked: "false" } }],
    })).toThrow();
  });
});
