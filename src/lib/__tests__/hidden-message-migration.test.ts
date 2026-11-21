import { describe, expect, it } from "vitest";
import { isPreviouslyHiddenMessage } from "../hidden-message-migration";
describe("upgrade from visual-only deletion", () => {
  it("migrates both globally and locally hidden messages", () => {
    expect(isPreviouslyHiddenMessage({ deletedForEveryone:true },"self")).toBe(true);
    expect(isPreviouslyHiddenMessage({ deletedFor:["self"] },"self")).toBe(true);
    expect(isPreviouslyHiddenMessage({ deletedFor:["other"] },"self")).toBe(false);
    expect(isPreviouslyHiddenMessage({ editedText:"hi" },"self")).toBe(false);
  });
  it("fails closed on malformed lifecycle records", () => {
    expect(isPreviouslyHiddenMessage(null,"self")).toBe(false);
    expect(isPreviouslyHiddenMessage([],"self")).toBe(false);
    expect(isPreviouslyHiddenMessage({ deletedFor:"self" },"self")).toBe(false);
  });
});

import { unreferencedFileIds, redactLocalMessage } from "../message-deletion-policy";
describe("bounded legacy redaction keeps shared attachments", () => {
  it("redacts a target before checking survivors and retains only live file references", () => {
    const removed = { id: "hidden", text: "personal secret",
      media: { fileId: "only-hidden" }, caption: "also secret" };
    const shared = { ...removed, media: { fileId: "still-shared" } };
    const live = { id: "live", text: "friend's message",
      media: { fileId: "still-shared" } };
    expect(redactLocalMessage(removed)).not.toHaveProperty("media");
    expect(redactLocalMessage(shared)).not.toHaveProperty("caption");
    expect(unreferencedFileIds(["only-hidden", "still-shared"],
      new Set([live.media.fileId]))).toEqual(["only-hidden"]);
  });
});

import { lifecycleRowsToPurgeForDeletedMessages } from "../backup-merge-policy";
import { queuedReactionEventIds } from "../reaction-deletion-policy";
describe("legacy hidden-message migration also scrubs former reaction dispatches", () => {
  it("cancels old signed reaction events and obsolete edit text, not durable tombstones", () => {
    const rows = [
      { key: "chat::m", chatKey: "chat", messageId: "m",
        data: { deletedFor: ["self"], editedText: "obsolete private text" } },
      { key: "reaction::peer::m", chatKey: "reaction::peer", messageId: "m",
        data: { emoji: "✅", outboundEventId: "signed-reaction-event" } },
      { key: '["deleted-message","m"]', chatKey: "deleted-message-local",
        messageId: "m", data: { deleted: true } },
      { key: "chat::n", chatKey: "chat", messageId: "n",
        data: { editedText: "someone else's message" } },
    ];
    const stale = lifecycleRowsToPurgeForDeletedMessages(rows, new Set(["m"]));
    expect(stale.map((r) => r.key)).toEqual(["chat::m", "reaction::peer::m"]);
    expect(queuedReactionEventIds(stale)).toEqual(["signed-reaction-event"]);
  });
});
