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
  it("never shares an external avatar URL", () => {
    expect(makeSharedProfile({...p,avatar:"https://tracking.test/avatar"}).avatar).toBeNull();
  });
});
