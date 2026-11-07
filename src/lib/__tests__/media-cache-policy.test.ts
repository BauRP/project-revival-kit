import { describe, expect, it } from "vitest";
import {
  canEvictUnreferencedMedia, MEDIA_ORPHAN_GRACE_MS,
} from "../media-cache-policy";

describe("media cache eviction must preserve active or recent uploads", () => {
  const now = Date.UTC(2026, 10, 7);
  const old = now - MEDIA_ORPHAN_GRACE_MS - 1;

  it("retains every referenced attachment regardless of age", () => {
    const referenced = new Set(["shared"]);
    expect(canEvictUnreferencedMedia({ fileId:"shared",storedAt:old,origin:"received" },referenced,now))
      .toBe(false);
    expect(canEvictUnreferencedMedia({ fileId:"other",storedAt:old,origin:"received" },referenced,now))
      .toBe(true);
  });
  it("retains a newly uploaded file until the sender can attach it", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"fresh",storedAt:now-2_000,origin:"received"},new Set(),now)).toBe(false);
    expect(canEvictUnreferencedMedia(
      {fileId:"old",storedAt:now-MEDIA_ORPHAN_GRACE_MS,origin:"received"},new Set(),now)).toBe(true);
  });
  it("does not purge untrusted or future-dated timestamps", () => {
    for (const storedAt of [-1, NaN, Infinity, now+1000]) {
      expect(canEvictUnreferencedMedia(
        {fileId:"file",storedAt,origin:"received"},new Set(),now)).toBe(false);
    }
    expect(canEvictUnreferencedMedia(
      {fileId:"file",storedAt:old,origin:"received"},new Set(),NaN)).toBe(false);
  });
  it("never interprets an invalid grace period as permission to evict", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"file",storedAt:old,origin:"received"},new Set(),now,-1)).toBe(false);
  });
});

describe("local user files and legacy unknown blobs are never cache-evicted", () => {
  const now = Date.UTC(2026, 10, 7);
  const longAgo = now - 365 * 24 * 60 * 60 * 1000;

  it("preserves locally uploaded attachments even before send and after a year", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"my-upload",storedAt:longAgo,origin:"local"},new Set(),now)).toBe(false);
  });

  it("preserves unknown legacy and backup-restored blobs unless explicitly deleted", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"legacy",storedAt:longAgo},new Set(),now)).toBe(false);
    expect(canEvictUnreferencedMedia(
      {fileId:"legacy",storedAt:longAgo,origin:"received"},new Set(),now)).toBe(true);
  });
});

import { isMatchingReceivedCache } from "../media-cache-policy";

describe("signed media does not overwrite an existing fileId", () => {
  const incoming = {name:"photo.jpg",mimeType:"image/jpeg",size:123};
  it("never replaces a local upload or unclassified old blob", () => {
    expect(isMatchingReceivedCache({...incoming,origin:"local"}, incoming)).toBe(false);
    expect(isMatchingReceivedCache(incoming, incoming)).toBe(false);
  });
  it("accepts an exact retransmission of an already validated received blob", () => {
    expect(isMatchingReceivedCache({...incoming,origin:"received"},incoming)).toBe(true);
  });
  it("rejects changed sender name, content type and length", () => {
    const previous={...incoming,origin:"received"};
    expect(isMatchingReceivedCache(previous,{...incoming,name:"other.jpg"})).toBe(false);
    expect(isMatchingReceivedCache(previous,{...incoming,mimeType:"text/html"})).toBe(false);
    expect(isMatchingReceivedCache(previous,{...incoming,size:321})).toBe(false);
  });
});
