import { describe, it, expect } from "vitest";
import { isLocalSupportPeer } from "../local-only-peer-policy";
describe("local-only delivery must never spoof Tor success", () => {
  it("only permits the bundled support identity", () => {
    expect(isLocalSupportPeer("TRIVO_MOCK_PEER_999")).toBe(true);
    for (const input of ["", "friend", "friend.onion", "https://example.com", "TRIVO_MOCK_PEER_998"])
      expect(isLocalSupportPeer(input)).toBe(false);
  });
});
