import { describe, expect, it } from "vitest";
import { chunkDigest, matchesChunkDigest } from "../chunk-integrity";

describe("sealed Tor media chunk integrity", () => {
  it("accepts the exact received bytes", () => {
    const bytes = new Uint8Array([0,1,2,127,255]);
    const digest = chunkDigest(bytes);
    expect(digest).toMatch(/^[0-9a-f]{128}$/);
    expect(matchesChunkDigest(bytes, digest)).toBe(true);
  });
  it("rejects corruption, missing and malformed hashes", () => {
    const bytes = new Uint8Array([1,2,3]);
    expect(matchesChunkDigest(new Uint8Array([1,2,4]), chunkDigest(bytes))).toBe(false);
    expect(matchesChunkDigest(bytes, undefined)).toBe(false);
    expect(matchesChunkDigest(bytes, "000000")).toBe(false);
  });
});