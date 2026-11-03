import { describe, expect, it } from "vitest";
import {
  deletedMessageKey, findUnreferencedMedia, isDeletedMessageRecord, messageMediaFileId,
} from "../message-deletion-policy";
describe("local deletion and Tor replay defense", () => {
  it("retains explicit tombstones for messages even after text/media removal", () => {
    expect(deletedMessageKey("msg")).toBe('["deleted-message","msg"]');
    expect(deletedMessageKey("msg")).not.toBe(deletedMessageKey("other"));
    expect(isDeletedMessageRecord({ deleted: true })).toBe(true);
    expect(isDeletedMessageRecord({ deleted: false })).toBe(false);
    expect(() => deletedMessageKey("")).toThrow();
    expect(() => deletedMessageKey("id\\u0000")).not.toThrow();
    expect(() => deletedMessageKey("id\u0000")).toThrow();
  });
  it("removes only orphaned files, not forwarded/shared attachments", () => {
    const removed = [{ media: { fileId: "f1" } }, { media: { fileId: "f2" } },
      { media: { fileId: "f2" } }, { media: null }];
    const remaining = [{ media: { fileId: "f2" } }];
    expect(findUnreferencedMedia(removed, remaining)).toEqual(["f1"]);
    expect(messageMediaFileId({ media: { fileId: 42 } })).toBeNull();
  });
});
