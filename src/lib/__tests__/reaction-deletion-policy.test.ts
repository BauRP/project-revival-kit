import { describe, expect, it } from "vitest";
import {
  canReactToVisibleMessage, pruneDeletedReactionMap,
} from "../reaction-deletion-policy";

const me = "me.onion", peer = "peer.onion";
const sent = {id:"m",from:me,to:peer};
const incoming = {id:"m",from:peer,to:me};
describe("deleted message cannot regain a remote or locally queued reaction", () => {
  it("accepts only a live message shared by exact participants", () => {
    expect(canReactToVisibleMessage(sent,peer,me,undefined)).toBe(true);
    expect(canReactToVisibleMessage(incoming,peer,me,undefined)).toBe(true);
    expect(canReactToVisibleMessage({...sent,to:"third"},peer,me,undefined)).toBe(false);
    expect(canReactToVisibleMessage({...sent,id:""},peer,me,undefined)).toBe(false);
    expect(canReactToVisibleMessage(undefined,peer,me,undefined)).toBe(false);
  });
  it("refuses late authenticated reactions after delete-for-me or expiry", () => {
    for (const message of [sent,incoming]) {
      expect(canReactToVisibleMessage(message,peer,me,{deleted:true,deletedAt:12})).toBe(false);
    }
    expect(canReactToVisibleMessage(incoming,peer,me,{deleted:false})).toBe(true);
  });
  it("does not resurrect deleted legacy reactions when merging saved maps", () => {
    const map = {"removed":{alice:"❤️"},"live":{bob:"👍"}};
    const filtered = pruneDeletedReactionMap(map,new Set(["removed"]));
    expect(filtered).toEqual({live:{bob:"👍"}});
    expect(Object.getPrototypeOf(filtered)).toBeNull();
    expect(map.removed).toBeDefined();
  });
  it("cannot inject an inherited identifier into a reaction dictionary", () => {
    const map = Object.create(null) as Record<string,string>;
    map["__proto__"] = "unsafe";
    map["safe"] = "ok";
    const filtered = pruneDeletedReactionMap(map, new Set(["__proto__"]));
    expect(filtered.safe).toBe("ok");
    expect(Object.prototype.hasOwnProperty.call(filtered,"__proto__")).toBe(false);
  });
});

import { queuedReactionEventIds } from "../reaction-deletion-policy";

describe("deletion cancels queued reactions under their actual event IDs", () => {
  it("cancels all immutable dispatch IDs and deduplicates retries", () => {
    expect(queuedReactionEventIds([
      {chatKey:"reaction::peer",data:{outboundEventId:"event-one"}},
      {chatKey:"reaction::peer",data:{outboundEventId:"event-two"}},
      {chatKey:"reaction::peer",data:{outboundEventId:"event-one"}},
      {chatKey:"other",data:{outboundEventId:"unrelated"}},
    ])).toEqual(["event-one","event-two"]);
  });
  it("ignores invalid IDs and unrelated lifecycle rows", () => {
    expect(queuedReactionEventIds([
      {chatKey:"reaction::peer",data:{outboundEventId:""}},
      {chatKey:"reaction::peer",data:{outboundEventId:"invalid\n"}},
      {chatKey:"reaction::peer",data:{outboundEventId:42}},
      {chatKey:"reaction::peer",data:{outboundEventId:"x".repeat(129)}},
      {chatKey:"profile::peer",data:{outboundEventId:"not-a-reaction"}},
    ])).toEqual([]);
  });
});

import { normalizeLegacyReactions } from "../reaction-policy";
describe("safe legacy reaction recovery", () => {
  it("keeps valid reactions and discards malformed actors", () => {
    const map = normalizeLegacyReactions({
      message: { alice: "👍", wrong: 42 },
      invalid: "bad",
    });
    expect(map.message.alice).toBe("👍");
    expect(Object.hasOwn(map.message, "wrong")).toBe(false);
    expect(Object.hasOwn(map, "invalid")).toBe(false);
    expect(Object.getPrototypeOf(map)).toBeNull();
  });
});

import { isCurrentReactionEnqueue } from "../reaction-policy";
describe("superseded reaction before encrypted Tor dispatch", () => {
  const row = {chatKey:"reaction::peer",messageId:"m",updatedAt:10,
    data:{outboundEventId:"event",outboundPending:true,emoji:"👍"}};
  it("accepts only its current immutable event and emoji", () => {
    expect(isCurrentReactionEnqueue(row,"peer","m","event","👍",10)).toBe(true);
    expect(isCurrentReactionEnqueue(row,"peer","m","old","👍",10)).toBe(false);
    expect(isCurrentReactionEnqueue(row,"peer","m","event","❤️",10)).toBe(false);
    expect(isCurrentReactionEnqueue({...row,data:{...row.data,outboundPending:false}},
      "peer","m","event","👍",10)).toBe(false);
    expect(isCurrentReactionEnqueue(row,"other","m","event","👍",10)).toBe(false);
  });
});

import { isRecoverableReactionRow } from "../reaction-policy";
describe("reaction recovery after an interrupted WebView", () => {
  const original = {
    chatKey: "reaction::peer", messageId: "message",
    data: { reactorId: "my-id", outboundPending: true },
  };
  it("replays only currently pending rows for the right local identity", () => {
    expect(isRecoverableReactionRow(original, "my-id")).toBe(true);
    expect(isRecoverableReactionRow(original, "other-id")).toBe(false);
    expect(isRecoverableReactionRow({
      ...original, data: { ...original.data, outboundPending: false },
    }, "my-id")).toBe(false);
    expect(isRecoverableReactionRow({ ...original, messageId: "" }, "my-id")).toBe(false);
  });
});

import { hasReactionDeletionMarker } from "../reaction-deletion-policy";
import { shouldApplyRemoteReaction } from "../reaction-policy";
import { nextReactionUpdatedAt } from "../reactions";

describe("reactions do not reappear after corrupt canonical tombstones", () => {
  it("considers any existing deletion row authoritative", () => {
    expect(hasReactionDeletionMarker(undefined)).toBe(false);
    for (const row of [
      { data: { deleted: true } },
      { data: { deleted: false } },
      { data: "damaged" },
      { data: null },
    ]) expect(hasReactionDeletionMarker(row)).toBe(true);
  });
  it("rejects signed invalid reaction timestamps on first delivery and replay", () => {
    for (const bad of [NaN, Infinity, -1, 0, 1.5]) {
      expect(shouldApplyRemoteReaction(undefined, bad)).toBe(false);
    }
    expect(shouldApplyRemoteReaction(undefined, 100)).toBe(true);
    expect(shouldApplyRemoteReaction(100, 100)).toBe(false);
    expect(shouldApplyRemoteReaction(100, 101)).toBe(true);
  });
  it("keeps local reaction clocks monotonic after backwards clock correction", () => {
    expect(nextReactionUpdatedAt(500, 100)).toBe(501);
    expect(nextReactionUpdatedAt(NaN, 100)).toBe(100);
    expect(() => nextReactionUpdatedAt(20, NaN)).toThrow();
    expect(() => nextReactionUpdatedAt(Number.MAX_SAFE_INTEGER, 100)).toThrow();
  });
});
