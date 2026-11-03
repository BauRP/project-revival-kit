import { describe, expect, it } from "vitest";
import { boundedChunkIndexes, MAX_MEDIA_CHUNKS } from "../blob-request-policy";

describe("untrusted Tor media retry index limits", () => {
  it("deduplicates valid received and missing chunk indices", () => {
    expect([...boundedChunkIndexes([0,1,0,10])!]).toEqual([0,1,10]);
    expect(boundedChunkIndexes([])).toEqual(new Set());
  });
  it("rejects malformed and out of range indices instead of coercing", () => {
    for (const x of [null, {}, ["0"], [0,1.5],[-1],[NaN],[Infinity],[MAX_MEDIA_CHUNKS]])
      expect(boundedChunkIndexes(x)).toBeNull();
  });
  it("rejects pathological arrays before iterating through every entry", () => {
    expect(boundedChunkIndexes(Array(MAX_MEDIA_CHUNKS + 1).fill(0))).toBeNull();
  });
});
