import { describe, expect, it } from "vitest";
import { onionFromPublicKey } from "../onion-id";
import { createRemovedContactMarker, removedContactKey, isRemovedContactMarker } from "../contact-removal-policy";
const peer=onionFromPublicKey(new Uint8Array(32).fill(7));
describe("durable friend removal", () => {
  it("uses only the real Tor identity and never stores a name", () => {
    const row=createRemovedContactMarker(peer, 100);
    expect(row.key).toBe(removedContactKey(peer));
    expect(isRemovedContactMarker(row)).toBe(true);
    expect(JSON.stringify(row)).not.toContain("displayName");
  });
  it("fails closed for forged or malformed markers", () => {
    const row=createRemovedContactMarker(peer, 100);
    for(const bad of [{...row,key:"fake"},{...row,messageId:"bad"},{...row,data:{removed:false}},
      {...row,updatedAt:0}]) expect(isRemovedContactMarker(bad)).toBe(false);
    expect(() => removedContactKey("fake.onion")).toThrow();
  });
  it("rejects invalid timestamps", () => {
    for(const bad of [-1,0,NaN,Infinity,1.5])
      expect(() => createRemovedContactMarker(peer,bad)).toThrow();
  });
});
