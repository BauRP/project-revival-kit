import { describe, expect, it } from "vitest";
import { orderedCompleteChunkSet, MEDIA_CHUNK_SIZE } from "../media-chunks";
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