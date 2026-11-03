import { describe, expect, it } from "vitest";
import { onionFromPublicKey } from "../onion-id";
import { validateIncomingFriendRequest, shouldApplyIncomingFriendRequest,
  validateOutgoingFriendRequest } from "../friend-request-policy";

const onion = onionFromPublicKey(new Uint8Array(32).fill(1));
const other = onionFromPublicKey(new Uint8Array(32).fill(2));
const payload = { from: onion, to: other, fromName: "New friend", timestamp: 1000 };
describe("Tor friend request durability and safety", () => {
  it("normalizes an authenticated friend request without propagating extra fields", () => {
    const value = validateIncomingFriendRequest({ ...payload, privileged: true }, 1000);
    expect(value).toEqual({ type:"friend_request", ...payload, status:"pending" });
    expect(value).not.toHaveProperty("privileged");
  });
  it("rejects invalid peer name, future timestamp and malformed identity", () => {
    expect(validateIncomingFriendRequest({ ...payload, fromName:"x\nadmin" },1000)).toBeNull();
    expect(validateIncomingFriendRequest({ ...payload, timestamp:900_000 },1000)).toBeNull();
    expect(validateIncomingFriendRequest({ ...payload, from:"attacker" },1000)).toBeNull();
    expect(() => validateOutgoingFriendRequest("attacker",other,"Hello")).toThrow();
  });
  it("never rolls an accepted invitation back to pending on a signed replay", () => {
    expect(shouldApplyIncomingFriendRequest({status:"accepted",timestamp:200},300)).toBe(false);
    expect(shouldApplyIncomingFriendRequest({status:"declined",timestamp:200},300)).toBe(false);
    expect(shouldApplyIncomingFriendRequest({status:"pending",timestamp:200},200)).toBe(false);
    expect(shouldApplyIncomingFriendRequest({status:"pending",timestamp:200},201)).toBe(true);
  });
});
