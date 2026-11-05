import { describe, expect, it } from "vitest";
import {
  deletedMessageKey, findUnreferencedMedia, isDeletedMessageRecord, messageMediaFileId,
} from "../message-deletion-policy";
describe("local deletion and Tor replay defense", () => {
  it("retains explicit tombstones for messages even after text/media removal", () => {
    expect(deletedMessageKey("msg")).toBe('["deleted-message","msg"]');
    expect(deletedMessageKey("msg")).not.toBe(deletedMessageKey("other"));
    expect(isDeletedMessageRecord({ deleted: true })).toBe(true);
    expect(isDeletedMessageRecord({ deleted: false })).toBe(false);
    expect(() => deletedMessageKey("")).toThrow();
    expect(() => deletedMessageKey("id\\u0000")).not.toThrow();
    expect(() => deletedMessageKey("id\u0000")).toThrow();
  });
  it("removes only orphaned files, not forwarded/shared attachments", () => {
    const removed = [{ media: { fileId: "f1" } }, { media: { fileId: "f2" } },
      { media: { fileId: "f2" } }, { media: null }];
    const remaining = [{ media: { fileId: "f2" } }];
    expect(findUnreferencedMedia(removed, remaining)).toEqual(["f1"]);
    expect(messageMediaFileId({ media: { fileId: 42 } })).toBeNull();
  });
});

import { mergedDeletionIds } from "../message-deletion-policy";
describe("tombstones across a non-destructive backup merge", () => {
  it("preserves current and restored deletes for existing messages", () => {
    const ids=mergedDeletionIds([{messageId:"local",data:{deleted:true}}],
      [{messageId:"restored",data:{deleted:true}},{messageId:"ignored",data:{deleted:false}}]);
    expect([...ids].sort()).toEqual(["local","restored"]);
    expect(ids.has("ignored")).toBe(false);
  });
});

import { redactLocalMessage } from "../message-deletion-policy";
describe("delete for me removes private plaintext while keeping placeholder identity", () => {
  it("scrubs text, edit caption and attachment without losing the message ID", () => {
    const message = {
      id: "important", text: "private text", caption: "secret caption",
      media: {fileId:"secret-file"}, from:"self", to:"peer", timestamp:200,
    };
    const redacted = redactLocalMessage(message);
    expect(redacted).toEqual({
      id:"important", text:"", from:"self", to:"peer", timestamp:200,
    });
    expect(message.text).toBe("private text");
  });
});

describe("remote deletion body erasure", () => {
  it("preserves the message identity but never retains body or attached media", () => {
    const input={id:"signed",text:"private",media:{fileId:"file"},caption:"secret",timestamp:300};
    const erased=redactLocalMessage(input);
    expect(erased.id).toBe("signed");
    expect(erased.timestamp).toBe(300);
    expect(erased.text).toBe("");
    expect(erased.media).toBeUndefined();
    expect(erased.caption).toBeUndefined();
  });
});

import { unusedBackupMedia } from "../message-deletion-policy";
describe("backup resurrection of previously deleted attachments", () => {
  it("rejects media solely referenced by a tombstoned backup message", () => {
    const messages = [{ id:"erased",media:{fileId:"old-secret"} },
      {id:"alive",media:{fileId:"kept"}}];
    expect(unusedBackupMedia(messages,new Set(["erased"]))).toEqual(["old-secret"]);
  });
  it("preserves legitimately shared attachments referenced by surviving messages", () => {
    const messages = [{id:"erased",media:{fileId:"shared"}},
      {id:"alive",media:{fileId:"shared"}}];
    expect(unusedBackupMedia(messages,new Set(["erased"]))).toEqual([]);
    expect(unusedBackupMedia([messages[0]],new Set(["erased"]),[{media:{fileId:"shared"}}])).toEqual([]);
  });
});

describe("deleted-message shell does not leak unknown private data", () => {
  it("drops translations, audio transcripts, replies and newly introduced fields", () => {
    const raw = {
      id:"m",from:"alice",to:"bob",timestamp:1,status:"delivered",text:"secret",
      translatedText:"секрет", transcription:"voice secret",
      replyPreview:"quoted secret", futureSecretPayload:"hidden",
      media:{fileId:"file"},caption:"caption secret",
    };
    const shell = redactLocalMessage(raw);
    expect(shell).toEqual({
      id:"m",from:"alice",to:"bob",timestamp:1,status:"delivered",text:"",
    });
    expect(JSON.stringify(shell)).not.toContain("secret");
  });
});

import { deletedLifecycleShell } from "../message-deletion-policy";
describe("local deletion lifecycle cannot retain prior plaintext", () => {
  it("whitelists tombstone fields while dropping previous edits and unknown private data", () => {
    const prior={deletedFor:["other"],deletedForEveryone:true,editedText:"SECRET",
      transcript:"SECRET AUDIO",pinnedBy:"other",remoteUpdatedAt:5};
    const shell=deletedLifecycleShell(prior,"m","self",12);
    expect(shell).toEqual({messageId:"m",deletedFor:["other","self"],
      deletedForEveryone:true,updatedAt:12,remoteUpdatedAt:5});
    expect(JSON.stringify(shell)).not.toContain("SECRET");
  });
});

import { isExpectedIncomingAttachment } from "../message-deletion-policy";
describe("late Tor media after local message deletion", () => {
  const message={from:"sender",to:"recipient",media:{fileId:"f_secret"}};
  it("only stores a received file belonging to the authenticated message", () => {
    expect(isExpectedIncomingAttachment(message,"sender","recipient","f_secret")).toBe(true);
    expect(isExpectedIncomingAttachment(message,"other","recipient","f_secret")).toBe(false);
    expect(isExpectedIncomingAttachment(message,"sender","other","f_secret")).toBe(false);
    expect(isExpectedIncomingAttachment({...message,media:undefined},"sender","recipient","f_secret")).toBe(false);
    expect(isExpectedIncomingAttachment(message,"sender","recipient","other")).toBe(false);
  });
});

// A signed message's metadata must match the chunk-assembled attachment.
import { matchesReceivedAttachmentMetadata } from "../message-deletion-policy";
describe("received Tor media cannot override signed message metadata", () => {
  const message = { from:"sender", to:"recipient", media:{
    fileId:"file", name:"image.png", mimeType:"image/png", size:1024,
  } };
  it("accepts only an exact match of file identity, MIME, name and byte size", () => {
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","file","image.png","image/png",1024)).toBe(true);
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","file","image.png","image/png",2048)).toBe(false);
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","file","image.svg","image/png",1024)).toBe(false);
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","file","image.png","text/html",1024)).toBe(false);
    expect(matchesReceivedAttachmentMetadata(message,"forged","recipient","file","image.png","image/png",1024)).toBe(false);
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","wrong","image.png","image/png",1024)).toBe(false);
    expect(matchesReceivedAttachmentMetadata(message,"sender","recipient","file","image.png","image/png",NaN)).toBe(false);
  });
});

import { matchesIncomingChunkManifest } from "../message-deletion-policy";
describe("signed Tor chunk manifest must match its parent message", () => {
  const msg = { from:"peer", to:"self", media:{
    fileId:"f", name:"sample.bin", mimeType:"application/octet-stream",
    size: 49155,
  } };
  it("accepts the expected two-part file manifest", () => {
    expect(matchesIncomingChunkManifest(msg,"peer","self","f","sample.bin",
      "application/octet-stream",2,48*1024)).toBe(true);
  });
  it("rejects spoofed name, MIME, number of chunks and participants", () => {
    expect(matchesIncomingChunkManifest(msg,"peer","self","f","sample.bin",
      "application/octet-stream",3,48*1024)).toBe(false);
    expect(matchesIncomingChunkManifest(msg,"peer","self","f","evil.html",
      "application/octet-stream",2,48*1024)).toBe(false);
    expect(matchesIncomingChunkManifest(msg,"peer","self","f","sample.bin",
      "text/html",2,48*1024)).toBe(false);
    expect(matchesIncomingChunkManifest(msg,"peer","other","f","sample.bin",
      "application/octet-stream",2,48*1024)).toBe(false);
    expect(matchesIncomingChunkManifest(msg,"peer","self","f","sample.bin",
      "application/octet-stream",2,0)).toBe(false);
  });
});

import { mayPersistIncomingChunk } from "../message-deletion-policy";
describe("atomic Tor chunk storage authorization", () => {
  it("never permits a late chunk after message deletion", () => {
    expect(mayPersistIncomingChunk({deleted:true},undefined)).toBe(false);
    expect(mayPersistIncomingChunk(undefined,{consumed:true})).toBe(false);
    expect(mayPersistIncomingChunk({deleted:false},{consumed:false})).toBe(true);
    expect(mayPersistIncomingChunk(undefined,undefined)).toBe(true);
  });
});
