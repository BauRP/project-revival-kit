import { describe, expect, it } from "vitest";
import {
  canEvictUnreferencedMedia, MEDIA_ORPHAN_GRACE_MS, verifiedBlobSize,
  canRepairReceivedCache, needsReceivedCacheRepair,
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
    expect(isMatchingReceivedCache({...incoming,origin:"received",data:new Blob([new Uint8Array(123)])},incoming)).toBe(true);
  });
  it("does not acknowledge a corrupted cached received attachment", () => {
    const incoming = { name: "photo.jpg", mimeType: "image/jpeg", size: 3 };
    expect(isMatchingReceivedCache({
      ...incoming, origin: "received", data: new Blob(["abc"]),
    }, incoming)).toBe(true);
    expect(isMatchingReceivedCache({
      ...incoming, origin: "received", data: new Blob(["wrong bytes"]),
    }, incoming)).toBe(false);
  });

  it("rejects changed sender name, content type and length", () => {
    const previous={...incoming,origin:"received"};
    expect(isMatchingReceivedCache(previous,{...incoming,name:"other.jpg"})).toBe(false);
    expect(isMatchingReceivedCache(previous,{...incoming,mimeType:"text/html"})).toBe(false);
    expect(isMatchingReceivedCache(previous,{...incoming,size:321})).toBe(false);
  });
});

describe("committed binary sizes control cache budget and safe eviction", () => {
  it("accounts for real stored binary bytes", () => {
    expect(verifiedBlobSize({size:3,data:new Blob(["abc"])})).toBe(3);
    expect(verifiedBlobSize({size:0,data:new Blob([])})).toBe(0);
  });
  it("fails safely on damaged size metadata or missing binary data", () => {
    for (const size of [0, 2, -1, NaN, Infinity, 1.5]) {
      expect(() => verifiedBlobSize({size,data:new Blob(["abc"])})).toThrow(/size/);
    }
    expect(() => verifiedBlobSize({
      size:3,data:undefined as unknown as Blob,
    })).toThrow(/size/);
  });
});

describe("received-media repair is restricted to authenticated metadata matches", () => {
  const metadata = { name: "photo.jpg", mimeType: "image/jpeg", size: 3 };
  const correct = new Blob(["abc"]);
  const damaged = { ...metadata, origin: "received", data: new Blob(["bad bytes"]) };

  it("refetches only a corrupt received-cache record", () => {
    expect(needsReceivedCacheRepair(damaged)).toBe(true);
    expect(needsReceivedCacheRepair({ ...metadata, origin: "received", data: correct })).toBe(false);
    expect(needsReceivedCacheRepair({ ...damaged, origin: "local" })).toBe(false);
    expect(needsReceivedCacheRepair({ ...damaged, origin: undefined })).toBe(false);
    expect(needsReceivedCacheRepair({ ...metadata, origin: "received" })).toBe(true);
  });
  it("repairs a corrupt received blob with matching signed parent metadata", () => {
    expect(canRepairReceivedCache(damaged, metadata, correct)).toBe(true);
    expect(isMatchingReceivedCache(damaged, metadata)).toBe(false);
  });
  it("never overwrites a healthy record, local upload or unclassified legacy blob", () => {
    expect(canRepairReceivedCache({ ...damaged, data: correct }, metadata, correct)).toBe(false);
    expect(canRepairReceivedCache({ ...damaged, origin: "local" }, metadata, correct)).toBe(false);
    expect(canRepairReceivedCache({ ...damaged, origin: undefined }, metadata, correct)).toBe(false);
  });
  it("refuses mismatched signed name, type, length or retransmitted binary size", () => {
    expect(canRepairReceivedCache(damaged, { ...metadata, name: "other" }, correct)).toBe(false);
    expect(canRepairReceivedCache(damaged, { ...metadata, mimeType: "application/octet-stream" }, correct)).toBe(false);
    expect(canRepairReceivedCache(damaged, { ...metadata, size: 4 }, correct)).toBe(false);
    expect(canRepairReceivedCache(damaged, metadata, new Blob(["wrong bytes"]))).toBe(false);
  });
  it("refuses damaged size metadata rather than guessing binary ownership", () => {
    expect(canRepairReceivedCache({ ...damaged, size: NaN }, metadata, correct)).toBe(false);
    expect(canRepairReceivedCache({ ...damaged, size: -1 }, metadata, correct)).toBe(false);
  });
});
