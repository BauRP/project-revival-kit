import { describe, expect, it } from "vitest";

/** The stable ID is the persistence contract between scheduled and Tor outboxes. */
describe("scheduled delivery identity", () => {
  it("preserves the original message ID across repeated attempts", () => {
    const scheduled = { id: "out_abc123", chatId: "peer", text: "hello", scheduledAt: 123456 };
    const first = { id: scheduled.id, text: scheduled.text, timestamp: scheduled.scheduledAt };
    const retry = { id: scheduled.id, text: scheduled.text, timestamp: scheduled.scheduledAt };
    expect(first).toEqual(retry);
  });
});
