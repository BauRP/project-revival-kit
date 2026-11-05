import { describe, expect, it } from "vitest";
import { MAX_MEDIA_CHUNKS } from "../blob-request-policy";
import {
  nextMissingChunkPage, initialTransferWindow, MAX_MISSING_CHUNKS_PER_RETRY,
} from "../media-retry-policy";

describe("bounded and fair Tor media retry pages", () => {
  it("never sends thousands of missing indices in one signed retry", () => {
    const page = nextMissingChunkPage(MAX_MEDIA_CHUNKS, new Set<number>());
    expect(page.missing).toHaveLength(MAX_MISSING_CHUNKS_PER_RETRY);
    expect(page.missing[0]).toBe(0);
    expect(page.missing.at(-1)).toBe(127);
    expect(page.nextCursor).toBe(128);
    const second = nextMissingChunkPage(MAX_MEDIA_CHUNKS, new Set<number>(), page.nextCursor);
    expect(second.missing[0]).toBe(128);
    expect(second.missing.at(-1)).toBe(255);
  });
  it("skips complete parts, wraps around and eventually covers all missing indices", () => {
    const received = new Set([0, 1, 3, 5, 7, 9]);
    const page = nextMissingChunkPage(10, received, 8, 3);
    expect(page.missing).toEqual([8, 2, 4]);
    expect(page.nextCursor).toBe(5);
    expect(nextMissingChunkPage(10, received, page.nextCursor, 3).missing).toEqual([6, 8, 2]);
  });
  it("never requests an already completed attachment", () => {
    expect(nextMissingChunkPage(3, new Set([0, 1, 2]))).toEqual({
      missing: [], nextCursor: 0,
    });
  });
  it("rejects corrupted indexes and unbounded requests before processing", () => {
    const received = new Set<number>();
    for (const total of [0, -1, 1.5, MAX_MEDIA_CHUNKS + 1, Number.POSITIVE_INFINITY]) {
      expect(() => nextMissingChunkPage(total, received)).toThrow();
    }
    expect(() => nextMissingChunkPage(4, received, 4)).toThrow();
    expect(() => nextMissingChunkPage(4, received, 0, 129)).toThrow();
  });
});

describe("first Tor media request resumes near saved chunks", () => {
  it("starts at the first missing index after a recovered prefix", () => {
    const received = new Set(Array.from({length: 800}, (_, i) => i));
    expect(initialTransferWindow(1000, received))
      .toEqual({ windowStart:800, windowCount:128, have:[] });
  });
  it("sends only known indexes inside the small initial window", () => {
    expect(initialTransferWindow(5, new Set([0,2,4])))
      .toEqual({ windowStart:1, windowCount:4, have:[2,4] });
  });
  it("keeps new and tiny transfers bounded", () => {
    expect(initialTransferWindow(null, new Set()))
      .toEqual({windowStart:0,windowCount:128,have:[]});
    expect(initialTransferWindow(2, new Set()))
      .toEqual({windowStart:0,windowCount:2,have:[]});
  });
});
