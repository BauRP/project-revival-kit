import { describe, expect, it } from "vitest";
import {
  canEvictUnreferencedMedia, MEDIA_ORPHAN_GRACE_MS,
} from "../media-cache-policy";

describe("media cache eviction must preserve active or recent uploads", () => {
  const now = Date.UTC(2026, 10, 7);
  const old = now - MEDIA_ORPHAN_GRACE_MS - 1;

  it("retains every referenced attachment regardless of age", () => {
    const referenced = new Set(["shared"]);
    expect(canEvictUnreferencedMedia({ fileId:"shared",storedAt:old },referenced,now))
      .toBe(false);
    expect(canEvictUnreferencedMedia({ fileId:"other",storedAt:old },referenced,now))
      .toBe(true);
  });
  it("retains a newly uploaded file until the sender can attach it", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"fresh",storedAt:now-2_000},new Set(),now)).toBe(false);
    expect(canEvictUnreferencedMedia(
      {fileId:"old",storedAt:now-MEDIA_ORPHAN_GRACE_MS},new Set(),now)).toBe(true);
  });
  it("does not purge untrusted or future-dated timestamps", () => {
    for (const storedAt of [-1, NaN, Infinity, now+1000]) {
      expect(canEvictUnreferencedMedia(
        {fileId:"file",storedAt},new Set(),now)).toBe(false);
    }
    expect(canEvictUnreferencedMedia(
      {fileId:"file",storedAt:old},new Set(),NaN)).toBe(false);
  });
  it("never interprets an invalid grace period as permission to evict", () => {
    expect(canEvictUnreferencedMedia(
      {fileId:"file",storedAt:old},new Set(),now,-1)).toBe(false);
  });
});
