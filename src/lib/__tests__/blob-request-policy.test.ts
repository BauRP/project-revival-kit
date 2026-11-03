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

import { validBlobFileId } from "../blob-request-policy";
describe("signed Tor media identifiers are never coerced", () => {
  it("allows known opaque file identifiers", () => {
    expect(validBlobFileId("f_58a13e67-68d3-478b-9cf0-d8b438da0e09")).toBe(true);
  });
  it("rejects objects, paths and oversized identities before DB access", () => {
    for (const invalid of [null, 0, {}, {toString:"crash"}, [], "", "x".repeat(129), "../evil", "a\\b", "bad\nname"])
      expect(validBlobFileId(invalid)).toBe(false);
  });
});
