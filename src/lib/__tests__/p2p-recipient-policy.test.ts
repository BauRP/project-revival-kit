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

import { validateLegacyMigrationMessage } from "../p2p";
describe("bounded legacy migration never discards unreadable old chat records", () => {
  const msg = { id: "old", from: "me", to: "friend", text: "my history", timestamp: 1 };
  it("accepts historical message identity without demanding new network fields", () => {
    expect(validateLegacyMigrationMessage(msg, "old")).toBe(true);
    expect(validateLegacyMigrationMessage({ ...msg, status: undefined }, "old")).toBe(true);
  });
  it("fails closed on key conflict, missing owner, damaged data and forged ID", () => {
    for (const [record, key] of [
      [{ ...msg, id: "other" }, "old"],
      [{ ...msg, id: "" }, ""],
      [{ ...msg, id: "bad\nkey" }, "bad\nkey"],
      [{ ...msg, from: "" }, "old"],
      [{ ...msg, text: null }, "old"],
      [{ ...msg, timestamp: NaN }, "old"],
      [null, "old"],
    ] as Array<[unknown, string]>) {
      expect(validateLegacyMigrationMessage(record, key)).toBe(false);
    }
  });
});
