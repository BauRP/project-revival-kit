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
  it("does not archive deleted message plaintext, stale edits or orphaned media", () => {
    const erased = {
      ...baseMessage("erased", "old-secret"),
      text: "private deleted text", caption: "private caption",
      hiddenTranslation: "private translation",
    };
    const deleted: LifecycleRecord = {
      key:'["deleted-message","erased"]', chatKey:"deleted-message-local",
      messageId:"erased", data:{ deleted:true }, updatedAt:10,
    };
    const staleEdit: LifecycleRecord = {
      key:"peer::erased", chatKey:"peer", messageId:"erased",
      data:{ editedText:"private old edit" }, updatedAt:9,
    };
    const surviving = baseMessage("alive", "keep-file");
    const result = sanitizePortableExportPrivacy(
      [erased,surviving],[deleted,staleEdit],[blob("old-secret"),blob("keep-file")],
    );
    expect(result.messages.map((row) => row.id)).toEqual(["alive"]);
    expect(result.lifecycle).toEqual([deleted]);
    expect(result.blobs.map((row) => row.fileId)).toEqual(["keep-file"]);
    expect(JSON.stringify({ messages: result.messages, lifecycle: result.lifecycle }))
      .not.toContain("private");
    // Export must not mutate live IndexedDB snapshot objects.
    expect(erased.text).toBe("private deleted text");
  });
  it("retains media still referenced by another surviving message", () => {
    const deleted: LifecycleRecord = {
      key:'["deleted-message","erased"]', chatKey:"deleted-message-local",
      messageId:"erased", data:{ deleted:true }, updatedAt:10,
    };
    const result = sanitizePortableExportPrivacy(
      [baseMessage("erased","shared"),baseMessage("alive","shared")],
      [deleted], [blob("shared")],
    );
    expect(result.messages.map((row) => row.id)).toEqual(["alive"]);
    expect(result.blobs.map((row) => row.fileId)).toEqual(["shared"]);
  });
  it("refuses portable export with corrupt or mismatched irreversible rows", () => {
    const edited: LifecycleRecord = {
      key:"peer::m", chatKey:"peer", messageId:"m",
      data:{editedText:"legitimate"},updatedAt:1,
    };
    for (const bad of [
      {key:"wrong",chatKey:"deleted-message-local",messageId:"m",data:{deleted:true},updatedAt:2},
      {key:'["deleted-message","m"]',chatKey:"deleted-message-local",messageId:"m",data:{deleted:false},updatedAt:2},
      {key:"consumed-media::file",chatKey:"consumed-media",messageId:"file",data:{consumed:false},updatedAt:2},
      marker(deletedFile,false),
    ] as LifecycleRecord[]) {
      expect(() => sanitizePortableExportPrivacy(
        [baseMessage("m","media")], [bad,edited], [blob("media")],
      )).toThrow("Cannot export with corrupted privacy marker");
    }
  });
  it("preserves user media without irreversible tombstones", () => {
    const input=[baseMessage("m1",ordinaryFile)];
    const result=sanitizePortableExportPrivacy(input,[],[blob(ordinaryFile)]);
    expect(result.blobs).toHaveLength(1);
    expect(input[0].media).toBeDefined();
  });
});
