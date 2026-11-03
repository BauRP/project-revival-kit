import { describe, expect, it } from "vitest";
import { nextReactionUpdatedAt, reactionRecordKey } from "../reactions";
describe("reaction ordering and identity", () => {
  it("uses a monotonic timestamp across rapid toggles", () => {
    expect(nextReactionUpdatedAt(100, 100)).toBe(101);
    expect(nextReactionUpdatedAt(101, 100)).toBe(102);
    expect(nextReactionUpdatedAt(102, 300)).toBe(300);
  });
  it("isolates every participant's reaction to a message", () => {
    expect(reactionRecordKey("peer","message","alice"))
      .not.toBe(reactionRecordKey("peer","message","bob"));
    expect(reactionRecordKey("peer","message","alice"))
      .not.toBe(reactionRecordKey("other","message","alice"));
  });
});
