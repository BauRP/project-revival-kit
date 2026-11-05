import { describe, expect, it } from "vitest";
import { boundedChunkIndexes, boundedMediaTransferWindow, MAX_MEDIA_TRANSFER_WINDOW, MAX_MEDIA_CHUNKS } from "../blob-request-policy";

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

// A malicious/overwhelmed peer cannot force the initial file transfer to
// send tens of thousands of chunks in one request.
describe("bounded initial Tor media transfer window", () => {
  it("limits a large attachment to 128 chunks per request", () => {
    expect(boundedMediaTransferWindow(0,128,MAX_MEDIA_CHUNKS))
      .toEqual({start:0,count:128});
    expect(boundedMediaTransferWindow(500,128,MAX_MEDIA_CHUNKS))
      .toEqual({start:500,count:128});
  });
  it("clamps the last page to actual content", () => {
    expect(boundedMediaTransferWindow(195,128,200))
      .toEqual({start:195,count:5});
  });
  it("rejects out-of-range or oversized requests", () => {
    expect(MAX_MEDIA_TRANSFER_WINDOW).toBe(128);
    for (const input of [
      [0,129,200],[-1,1,200],[200,1,200],[0,0,200],
      ["0",1,200],[0,1.5,200],[0,5,0],[0,1,MAX_MEDIA_CHUNKS+1],
    ] as unknown[][]) {
      expect(boundedMediaTransferWindow(input[0],input[1],input[2] as number)).toBeNull();
    }
  });
});
