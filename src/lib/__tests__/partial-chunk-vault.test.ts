import { describe, expect, it } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  MAX_DECRYPTED_CHUNK_BYTES, protectPartialChunkBytes,
  openPartialChunkBytes, persistedChunkPlainSize,
} from "../partial-chunk-vault";

const key = (value: number) => importLocalRecordKey(new Uint8Array(32).fill(value));
const rowId = JSON.stringify(["f_test", "sender.onion", 0]);

describe("partial Tor media encrypted with Android Keystore-backed data key", () => {
  it("encrypts a full 48 KiB binary fragment and recovers exact bytes", async () => {
    const source = new Uint8Array(MAX_DECRYPTED_CHUNK_BYTES);
    for (let i = 0; i < source.length; i++) source[i] = i % 251;
    const k = await key(1);
    const protectedChunk = await protectPartialChunkBytes(k, rowId, source);
    expect(protectedChunk.encrypted).toBe(1);
    expect(protectedChunk.plaintextSize).toBe(source.length);
    expect(protectedChunk.data.type).toBe("application/x-trivo-encrypted-chunk");
    expect(await protectedChunk.data.text()).not.toContain("f_test");
    const opened = await openPartialChunkBytes({ key: rowId, ...protectedChunk }, k);
    expect(opened).toEqual(source);
    expect(persistedChunkPlainSize(protectedChunk)).toBe(source.length);
  });
  it("rejects substitution of record IDs or keys and uses random nonces", async () => {
    const k = await key(2);
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    const a = await protectPartialChunkBytes(k, rowId, bytes);
    const b = await protectPartialChunkBytes(k, rowId, bytes);
    expect(await a.data.text()).not.toBe(await b.data.text());
    await expect(openPartialChunkBytes({key:"another-row",...a},k)).rejects.toThrow();
    await expect(openPartialChunkBytes({key:rowId,...a},await key(3))).rejects.toThrow();
  });
  it("preserves old unfinished transfers but cannot downgrade sealed blobs", async () => {
    const legacy = {key:rowId,data:new Blob([Uint8Array.from([2,5,9])])};
    expect(await openPartialChunkBytes(legacy)).toEqual(Uint8Array.from([2,5,9]));
    const sealed = await protectPartialChunkBytes(await key(4),rowId,Uint8Array.from([1]));
    await expect(openPartialChunkBytes({key:rowId,...sealed})).rejects.toThrow();
    await expect(openPartialChunkBytes({key:rowId,...sealed,encrypted:undefined}))
      .rejects.toThrow("Missing encrypted Tor chunk marker");
    expect(persistedChunkPlainSize({...sealed,encrypted:undefined})).toBe(-1);
  });
  it("rejects corrupted ciphertext, forged sizes and oversized plaintext", async () => {
    const k = await key(5);
    await expect(protectPartialChunkBytes(
      k,rowId,new Uint8Array(MAX_DECRYPTED_CHUNK_BYTES+1))).rejects.toThrow();
    const sealed = await protectPartialChunkBytes(k,rowId,Uint8Array.from([1,2,3]));
    expect(persistedChunkPlainSize({...sealed,encrypted:2 as never})).toBe(-1);
    await expect(openPartialChunkBytes({key:rowId,...sealed,plaintextSize:20},k))
      .rejects.toThrow();
    await expect(openPartialChunkBytes({key:rowId,...sealed,encrypted:2 as never},k))
      .rejects.toThrow();
    const tampered = new Blob([JSON.stringify({
      ...JSON.parse(await sealed.data.text()),nonce:"A".repeat(16),
    })],{type:"application/x-trivo-encrypted-chunk"});
    await expect(openPartialChunkBytes({key:rowId,...sealed,data:tampered},k))
      .rejects.toThrow();
  });
});
