import { describe, it, expect } from "vitest";
import { validateBackupStructure } from "../backup-validation";
const dump=()=>({schemaVersion:3,createdAt:1000,contacts:[],messages:[],outbox:[],lifecycle:[],blobs:[]});
describe("backup atomic import validation",()=>{
  it("accepts valid empty version 3 backup",()=>{
    expect(()=>validateBackupStructure(dump())).not.toThrow();
  });
  it("rejects malformed tables before modifying Dexie",()=>{
    expect(()=>validateBackupStructure({...dump(),messages:{}})).toThrow();
    expect(()=>validateBackupStructure({...dump(),contacts:[null]})).toThrow();
    expect(()=>validateBackupStructure({...dump(),createdAt:999999999999999})).toThrow();
  });
  it("rejects malformed media encodings and oversized blobs",()=>{
    expect(()=>validateBackupStructure({...dump(),blobs:[{
      fileId:"f",name:"a",mimeType:"image/png",size:3,dataB64:"malformed_"
    }]})).toThrow();
  });
});
