import { describe, expect, it } from "vitest";
import { consumedMediaKey, consumedMediaFileIds, hasConsumedMediaReference, isConsumedMediaRecord, isProtectedByConsumedTombstone, sanitizeRestoredOneTimeMessage } from "../one-time-policy";
describe("persistent one-time media replay prevention", () => {
  it("isolates a tombstone for each attachment", () => {
    expect(consumedMediaKey("f_a")).not.toBe(consumedMediaKey("f_b"));
    expect(() => consumedMediaKey("")).toThrow();
    expect(() => consumedMediaKey("x".repeat(257))).toThrow();
  });
  it("allows viewing only when an explicit consumed flag is absent", () => {
    expect(isConsumedMediaRecord({ consumed: true, consumedAt: Date.now() })).toBe(true);
    expect(isConsumedMediaRecord({ consumed: false })).toBe(false);
    expect(isConsumedMediaRecord(null)).toBe(false);
    expect(isConsumedMediaRecord({})).toBe(false);
  });
  it("builds one deduplicated revocation set and ignores unrelated keys", () => {
    const revoked = new Set([
      consumedMediaKey("a"), consumedMediaKey("b"),
      "unrelated::c", "consumed-media::",
    ]);
    expect(consumedMediaFileIds(revoked)).toEqual(new Set(["a", "b"]));
  });
  it("identifies only live message references to consumed attachments", () => {
    const revoked = consumedMediaFileIds(new Set([consumedMediaKey("a")]));
    expect(hasConsumedMediaReference({ media: { fileId: "a" } }, revoked)).toBe(true);
    for (const message of [
      { media: { fileId: "b" } },
      { media: { fileId: ["a"] } },
      { media: "a" },
      { media: null },
      {},
    ]) {
      expect(hasConsumedMediaReference(message, revoked)).toBe(false);
    }
  });
  it("never restores consumed media, even from an older backup", () => {
    const revoked = new Set([consumedMediaKey("f_a")]);
    const msg = { id:"msg", media: { fileId:"f_a" }, oneTimeView:true };
    expect(sanitizeRestoredOneTimeMessage(msg, revoked)).toMatchObject({
      id:"msg", media:undefined, oneTimeConsumed:true,
    });
    expect(isProtectedByConsumedTombstone("f_a", revoked)).toBe(true);
    expect(isProtectedByConsumedTombstone("f_b", revoked)).toBe(false);
  });
});
