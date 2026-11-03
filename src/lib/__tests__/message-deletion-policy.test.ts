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
