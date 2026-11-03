import { describe, expect, it } from "vitest";
import { nextReactionUpdatedAt, reactionRecordKey, isSameReactionDispatch } from "../reactions";
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
  it("does not clear a newer local reaction after an older dispatch completes", () => {
    expect(isSameReactionDispatch({outboundEventId:"event1",outboundPending:true},"event1")).toBe(true);
    expect(isSameReactionDispatch({outboundEventId:"event2",outboundPending:true},"event1")).toBe(false);
    expect(isSameReactionDispatch({outboundEventId:"event1",outboundPending:false},"event1")).toBe(false);
  });
});

import { shouldApplyRemoteReaction } from "../reactions";
describe("authenticated reaction replay ordering", () => {
  it("accepts the first remote reaction and only strictly newer changes", () => {
    expect(shouldApplyRemoteReaction(undefined,100)).toBe(true);
    expect(shouldApplyRemoteReaction(99,100)).toBe(true);
    expect(shouldApplyRemoteReaction(100,100)).toBe(false);
    expect(shouldApplyRemoteReaction(101,100)).toBe(false);
  });
});
