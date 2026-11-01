import { describe, expect, it } from "vitest";
import { isLegacyFriendEvent } from "../inbound-durability";

describe("incoming Tor cross-database durability", () => {
  it("retains friend events until the separate database transaction completes", () => {
    expect(isLegacyFriendEvent("friend_request")).toBe(true);
    expect(isLegacyFriendEvent("friend_request_status")).toBe(true);
  });
  it("commits all other dispatches to the transactional Dexie inbox", () => {
    for (const kind of ["text_message","message_lifecycle","message_reaction","message_status"]) {
      expect(isLegacyFriendEvent(kind)).toBe(false);
    }
  });
});
