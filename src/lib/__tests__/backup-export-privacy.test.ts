import { describe, expect, it } from "vitest";
import { sanitizePortableExportPrivacy } from "../backup-export-privacy";
import type { StoredMessage, LifecycleRecord, BlobRecord } from "../dexie-db";

const deletedFile = "once";
const ordinaryFile = "kept";
const baseMessage = (id: string, fileId: string): StoredMessage => ({
  id, from:"a.onion", to:"b.onion", text:"hello", timestamp:1,status:"read",
  media:{fileId,type:"image",name:"image.png",mimeType:"image/png",size:3,url:"blob:old-session"},
});
const blob = (fileId: string): BlobRecord => ({
  fileId, name:"image.png", mimeType:"image/png",size:3,
  data:new Blob([new Uint8Array([1,2,3])]),storedAt:1,
});
const marker = (id: string, canonical = true): LifecycleRecord => ({
  key: canonical ? `consumed-media::${id}` : "untrusted-key",
  chatKey:"consumed-media",messageId:id,data:{consumed:true},updatedAt:2,
});
describe("portable backup must not retain consumed media bytes", () => {
  it("excludes consumed Blob payloads and strips restored media previews", () => {
    const {messages,blobs} = sanitizePortableExportPrivacy(
      [baseMessage("m1",deletedFile),baseMessage("m2",ordinaryFile)],
      [marker(deletedFile)],
      [blob(deletedFile),blob(ordinaryFile)],
    );
    expect(blobs.map(x=>x.fileId)).toEqual([ordinaryFile]);
    expect(messages[0].media).toBeUndefined();
    expect(messages[0].oneTimeConsumed).toBe(true);
    expect((messages[1].media as {url:string}).url).toBe("");
  });
  it("does not trust a mismatched or forged consumed marker", () => {
    const result = sanitizePortableExportPrivacy(
      [baseMessage("m",deletedFile)], [marker(deletedFile,false)],
      [blob(deletedFile)],
    );
    expect(result.blobs).toHaveLength(1);
    expect(result.messages[0].media).toBeDefined();
  });
  it("preserves user media without irreversible tombstones", () => {
    const input=[baseMessage("m1",ordinaryFile)];
    const result=sanitizePortableExportPrivacy(input,[],[blob(ordinaryFile)]);
    expect(result.blobs).toHaveLength(1);
    expect(input[0].media).toBeDefined();
  });
});
