import { describe, expect, it } from "vitest";
import { mergeIncomingChatSummary } from "../chat-meta-policy";
import type { ChatMeta } from "../p2p";

const friendId = "a".repeat(56) + ".onion";
const initial = (): ChatMeta => ({
  friendId, friendName: "Friend", friendAvatar: "avatar",
  lastMessage: "recent", lastMessageTime: 300, lastMessageId: "m3",
  unread: 2, started: true,
});
describe("atomic chat summary merge", () => {
  it("increments unread without overwriting profile fields", () => {
    const a = mergeIncomingChatSummary(initial(), {
      friendId, messageId: "m4", text: "A", timestamp: 400,
    });
    const b = mergeIncomingChatSummary(a, {
      friendId, messageId: "m5", text: "B", timestamp: 500,
    });
    expect(b.unread).toBe(4);
    expect(b.friendName).toBe("Friend");
    expect(b.friendAvatar).toBe("avatar");
    expect(b.lastMessageId).toBe("m5");
  });
  it("does not replace newer preview with delayed message", () => {
    const result = mergeIncomingChatSummary(initial(), {
      friendId, messageId: "m2", text: "older", timestamp: 100,
    });
    expect(result.lastMessage).toBe("recent");
    expect(result.lastMessageTime).toBe(300);
    expect(result.unread).toBe(3);
  });
  it("does not count immediate replay of latest message", () => {
    const result = mergeIncomingChatSummary(initial(), {
      friendId, messageId: "m3", text: "recent", timestamp: 300,
    });
    expect(result.unread).toBe(2);
  });
  it("rejects invalid input", () => {
    expect(() => mergeIncomingChatSummary(undefined, {
      friendId, messageId: "", text: "x", timestamp: 1,
    })).toThrow();
    expect(() => mergeIncomingChatSummary(undefined, {
      friendId, messageId: "id", text: "x", timestamp: NaN,
    })).toThrow();
  });
});
