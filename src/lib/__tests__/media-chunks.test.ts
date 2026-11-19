import { describe, expect, it } from "vitest";
import { orderedCompleteChunkSet, MEDIA_CHUNK_SIZE, matchesSignedChunkByteLength } from "../media-chunks";
const row=(index:number,totalChunks=2)=>({fileId:"file",from:"sender",index,totalChunks,
  name:"file.bin",mimeType:"application/octet-stream",
  size:index===totalChunks-1?3:MEDIA_CHUNK_SIZE});
describe("recovering incomplete media chunks",()=>{
  it("reorders a completed manifest",()=>{
    expect(orderedCompleteChunkSet([row(1),row(0)],"file","sender")?.map(x=>x.index)).toEqual([0,1]);
  });
  it("rejects missing, repeated and unsolicited parts",()=>{
    expect(orderedCompleteChunkSet([row(0)],"file","sender")).toBeNull();
    expect(orderedCompleteChunkSet([row(0),row(0)],"file","sender")).toBeNull();
    expect(orderedCompleteChunkSet([row(0),row(1)],"file","other")).toBeNull();
  });
  it("rejects inconsistent metadata and malformed byte lengths",()=>{
    expect(orderedCompleteChunkSet([row(0),{...row(1),name:"changed"}],"file","sender")).toBeNull();
    expect(orderedCompleteChunkSet([{...row(0),size:10},row(1)],"file","sender")).toBeNull();
  });
});

describe("Tor chunk length must match the signed original file", () => {
  it("accepts full chunks and the exact final short chunk", () => {
    const size = MEDIA_CHUNK_SIZE * 2 + 19;
    expect(matchesSignedChunkByteLength(size, 3, 0, MEDIA_CHUNK_SIZE)).toBe(true);
    expect(matchesSignedChunkByteLength(size, 3, 2, 19)).toBe(true);
    expect(matchesSignedChunkByteLength(size, 3, 2, 18)).toBe(false);
    expect(matchesSignedChunkByteLength(size, 3, 2, 20)).toBe(false);
  });
  it("accepts an intentionally empty one-chunk file but not false empty finals", () => {
    expect(matchesSignedChunkByteLength(0, 1, 0, 0)).toBe(true);
    expect(matchesSignedChunkByteLength(7, 1, 0, 0)).toBe(false);
    expect(matchesSignedChunkByteLength(7, 1, 0, 7)).toBe(true);
  });
  it("refuses wrong manifest counts, absurd sizes and invalid lengths", () => {
    for (const bytes of [NaN,-1,1.5,Infinity,1024*1024*1024+1]) {
      expect(matchesSignedChunkByteLength(bytes, 1, 0, 1)).toBe(false);
    }
    expect(matchesSignedChunkByteLength(MEDIA_CHUNK_SIZE+1, 1, 0, 1)).toBe(false);
    expect(matchesSignedChunkByteLength(4, 1, -1, 4)).toBe(false);
  });
});
