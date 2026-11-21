import { describe, expect, it } from "vitest";
import { validateSharedProfile, makeSharedProfile } from "../profile-wire";
const id = "a".repeat(56) + ".onion";
const p = { userId:id, name:"Тест", avatar:null, status:"online" as const, customStatus:"Сәлем", updatedAt:1000 };
describe("Tor profile synchronization privacy", () => {
  it("accepts a bounded profile only from the signed author", () => {
    expect(validateSharedProfile(p,id,2000)).toEqual(p);
    expect(validateSharedProfile(p,"different.onion",2000)).toBeNull();
  });
  it("rejects oversized names, future timestamps and remote avatar URLs", () => {
    expect(validateSharedProfile({...p,name:"x".repeat(81)},id,2000)).toBeNull();
    expect(validateSharedProfile({...p,avatar:"https://example.com/track"},id,2000)).toBeNull();
    expect(validateSharedProfile({...p,updatedAt:9000000},id,2000)).toBeNull();
  });
  it("rejects JSON values masquerading as a valid status", () => {
    for (const invalid of [["online"], { toString: "online" }, 0, null]) {
      expect(validateSharedProfile({ ...p, status: invalid }, id, 2000)).toBeNull();
    }
  });
  it("never shares an external avatar URL", () => {
    expect(makeSharedProfile({...p,avatar:"https://tracking.test/avatar"}).avatar).toBeNull();
  });
  it("never sends extra internal fields when the local profile is augmented", () => {
    const augmented = {
      ...p,
      internalBackupKey: "private-backup-key-must-not-leak",
      deviceDiagnostics: {serial: "private"},
    };
    const shared = makeSharedProfile(augmented);
    expect(Object.keys(shared).sort()).toEqual(
      ["userId", "name", "avatar", "status", "customStatus", "updatedAt"].sort(),
    );
    expect(JSON.stringify(shared)).not.toContain("internalBackupKey");
    expect(JSON.stringify(shared)).not.toContain("deviceDiagnostics");
  });
});

import { canPublishProfileToPeer } from "../profile-wire";
import { onionFromPublicKey } from "../onion-id";
describe("outbound profile contact identity", () => {
  it("only allows checksum-valid lowercase raw onion hosts", () => {
    const onion = onionFromPublicKey(new Uint8Array(32).fill(4));
    expect(canPublishProfileToPeer(onion)).toBe(true);
    for (const id of ["https://" + onion, onion.toUpperCase(), onion + "/", "example.onion"]) {
      expect(canPublishProfileToPeer(id)).toBe(false);
    }
  });
});

describe("canonical profile avatar bytes before offline Tor sync", () => {
  it("accepts locally generated canonical image data", () => {
    expect(validateSharedProfile({
      ...p, avatar: "data:image/png;base64,AQ==",
    }, id, 2000)?.avatar).toBe("data:image/png;base64,AQ==");
  });
  it("rejects malformed padding, empty image and unsafe Base64", () => {
    for (const avatar of [
      "data:image/png;base64,",
      "data:image/png;base64,A",
      "data:image/png;base64,AR==",
      "data:image/jpeg;base64,AQJ=",
      "data:image/webp;base64,@@",
    ]) {
      expect(validateSharedProfile({ ...p, avatar }, id, 2000)).toBeNull();
      expect(makeSharedProfile({ ...p, avatar }).avatar).toBeNull();
    }
  });
});
