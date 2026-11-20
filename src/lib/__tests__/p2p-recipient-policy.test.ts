import { describe, expect, it } from "vitest";
import { isCanonicalFriendOnion } from "../friend-request-policy";
import { onionFromPublicKey } from "../onion-id";
import { isLocalSupportPeer } from "../local-only-peer-policy";

/** The local-only support fixture is the sole exception to a raw Tor host. */
function canAddressP2PRecipient(value: string): boolean {
  return isCanonicalFriendOnion(value) || isLocalSupportPeer(value);
}
describe("P2P destination identity", () => {
  const onion = onionFromPublicKey(new Uint8Array(32).fill(11));
  it("accepts only the authenticated raw lowercase onion host", () => {
    expect(canAddressP2PRecipient(onion)).toBe(true);
    expect(canAddressP2PRecipient("https://" + onion)).toBe(false);
    expect(canAddressP2PRecipient(onion.toUpperCase())).toBe(false);
    expect(canAddressP2PRecipient(onion + "/")).toBe(false);
    expect(canAddressP2PRecipient("a".repeat(56) + ".onion")).toBe(false);
  });
  it("retains the existing local support conversation", () => {
    expect(canAddressP2PRecipient("TRIVO_MOCK_PEER_999")).toBe(true);
    expect(canAddressP2PRecipient("OTHER_MOCK_PEER")).toBe(false);
  });
});
