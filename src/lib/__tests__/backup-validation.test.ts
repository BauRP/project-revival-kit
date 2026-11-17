import { describe, it, expect } from "vitest";
import { validateBackupStructure } from "../backup-validation";

const dump = () => ({
  schemaVersion: 3, createdAt: 1000,
  contacts: [], messages: [], outbox: [], lifecycle: [], blobs: [],
});
const blob = (size: number, dataB64: string) => ({
  fileId: "file-1", name: "picture.png", mimeType: "image/png",
  size, dataB64, storedAt: 1000,
});

describe("backup preflight validation", () => {
  it("accepts valid empty, padded and unpadded version 3 backups", () => {
    expect(() => validateBackupStructure(dump())).not.toThrow();
    expect(() => validateBackupStructure({ ...dump(), blobs: [blob(1, "AQ==")] })).not.toThrow();
    expect(() => validateBackupStructure({ ...dump(), blobs: [blob(3, "AQID")] })).not.toThrow();
  });

  it("rejects malformed tables and impossible metadata before touching Dexie", () => {
    expect(() => validateBackupStructure({ ...dump(), messages: {} })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), contacts: [null] })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), createdAt: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), messages: [{
      id: "id", from: "from", to: "to", text: "hello", timestamp: -1,
    }] })).toThrow();
  });

  it("rejects control characters in record identifiers and file names", () => {
    expect(() => validateBackupStructure({ ...dump(), contacts: [{ onion: "a\u0000b" }] })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), blobs: [blob(0, "")].map(x => ({
      ...x, name: "unsafe\u000a.png",
    })) })).toThrow();
  });

  it("rejects malformed optional metadata without breaking older V3 records", () => {
    const contact = { onion:"peer.onion", addedAt:1, lastSeen:2, displayName:"Peer" };
    const message = { id:"m", from:"from", to:"to", text:"hello", timestamp:1,
      status:"delivered", caption:"good",
      media:{ fileId:"f", id:"media-id", name:"photo.png", type:"image",
        mimeType:"image/png", size:1 } };
    const lifecycle = { key:"k", chatKey:"chat", messageId:"m",
      updatedAt:1, data:{} };
    expect(() => validateBackupStructure({...dump(),contacts:[contact],
      messages:[message],lifecycle:[lifecycle],blobs:[blob(1,"AQ==")]})).not.toThrow();
    for (const bad of [
      {contacts:[{...contact, addedAt:"yesterday"}]},
      {contacts:[{...contact, lastSeen:-1}]},
      {contacts:[{...contact, displayName:{bad:true}}]},
      {messages:[{...message, status:["delivered"]}]},
      {messages:[{...message, caption:"a".repeat(10001)}]},
      {messages:[{...message, media:{...message.media,type:["image"]}}]},
      {messages:[{...message, media:{...message.media,id:""}}]},
      {lifecycle:[{...lifecycle,updatedAt:"soon"}]},
      {blobs:[{...blob(1,"AQ=="),storedAt:NaN}]},
    ]) expect(() => validateBackupStructure({...dump(),...bad})).toThrow();
  });

  it("checks exact decoded attachment size and canonical padding", () => {
    for (const invalid of [
      blob(3, "AQ=="), // much shorter than the advertised attachment
      blob(1, "AQID"), // larger than the advertised attachment
      blob(1, "AAAA"), // missing the required padding
      blob(3, "malformed_"), blob(0, "AA=="),
      blob(1, "AR=="), // non-zero unused padding bits: decodes to 0x01
      blob(2, "AQJ="), // non-zero unused padding bits: decodes to 0x0102
    ]) expect(() => validateBackupStructure({ ...dump(), blobs: [invalid] })).toThrow();
  });

  it("rejects unsafe restored file paths, opaque IDs and MIME controls", () => {
    for (const invalid of [
      { ...blob(0, ""), name: "../escape.png" },
      { ...blob(0, ""), name: "folder\\\\escape.png" },
      { ...blob(0, ""), fileId: "../escape" },
      { ...blob(0, ""), mimeType: "image/png\n" },
    ]) expect(() => validateBackupStructure({ ...dump(), blobs: [invalid] })).toThrow();
    const message = {
      id:"m", from:"sender", to:"recipient", text:"file", timestamp:1,
      media:{ fileId:"file", type:"image", name:"../escape.png", mimeType:"image/png", size:1 },
    };
    expect(() => validateBackupStructure({ ...dump(), messages:[message] })).toThrow();
  });

  it("rejects huge record counts before a restore transaction", () => {
    expect(() => validateBackupStructure({
      ...dump(), outbox: new Array(250001).fill(null),
    })).toThrow();
  });
});

describe("encrypted outgoing records in portable backups", () => {
  const old = {
    id: "msg-1", peer: "peer.onion", kind: "text_message",
    frame: '{"v":2,"c":"encrypted"}',
    status: "sent", attempts: 3,
    createdAt: 1000, updatedAt: 2000, nextAttemptAt: 3000,
  };
  it("accepts historical encrypted outbox metadata without activating it", () => {
    expect(() => validateBackupStructure({ ...dump(), outbox: [old] })).not.toThrow();
  });
  it("rejects invalid future retry counters and oversized/missing ciphertext", () => {
    expect(() => validateBackupStructure({ ...dump(), outbox: [{ ...old, attempts: -1 }] })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), outbox: [{ ...old, frame: "" }] })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), outbox: [{ ...old, nextAttemptAt: "soon" }] })).toThrow();
    expect(() => validateBackupStructure({ ...dump(), outbox: [{ ...old, status: "delivered" }] })).toThrow();
    // A forged status object must not pass because String(value) is "sent".
    for (const status of [["sent"], { toString: "sent" }, null, 0]) {
      expect(() => validateBackupStructure({ ...dump(), outbox: [{
        ...old, status,
      }] })).toThrow();
    }
  });
});

// Validating archive primary keys prevents ambiguous restore ordering.
describe("durable backup privacy marker integrity", () => {
  it("accepts canonical permanent deletion and consumed media markers", () => {
    const removed = { key: '["deleted-message","m1"]',
      chatKey: "deleted-message-local", messageId:"m1", data:{deleted:true} };
    const viewed = { key:"consumed-media::f1",
      chatKey:"consumed-media",messageId:"f1",data:{consumed:true} };
    expect(() => validateBackupStructure({...dump(),lifecycle:[removed,viewed]})).not.toThrow();
  });
  it("refuses forged and duplicate privacy markers", () => {
    const record = { key:"consumed-media::f1",chatKey:"consumed-media",
      messageId:"f2",data:{consumed:true} };
    expect(() => validateBackupStructure({...dump(),lifecycle:[record]})).toThrow();
    const removed = { key:'["deleted-message","m1"]',
      chatKey:"deleted-message-local",messageId:"m2",data:{deleted:true} };
    expect(() => validateBackupStructure({...dump(),lifecycle:[removed]})).toThrow();
    const valid = {...record,messageId:"f1"};
    expect(() => validateBackupStructure({...dump(),lifecycle:[valid,valid]})).toThrow();
  });
});

describe("untrusted duplicate identifiers in backup archives", () => {
  it("rejects ambiguous contact, message, outbox and media IDs before restoring", () => {
    const contact = {onion:"peer.onion",addedAt:1};
    const msg = {id:"m",from:"peer",to:"self",text:"hello",timestamp:1};
    const outbox = {id:"o",peer:"peer.onion",kind:"text_message",
      frame:"ciphertext",status:"pending",attempts:0,
      createdAt:1,updatedAt:1,nextAttemptAt:1};
    for (const overrides of [
      {contacts:[contact,contact]}, {messages:[msg,msg]},
      {outbox:[outbox,outbox]}, {blobs:[blob(1,"AQ=="),blob(1,"AQ==")]},
    ]) {
      expect(() => validateBackupStructure({...dump(),...overrides})).toThrow(/Duplicate/);
    }
  });
});

describe("portable remote-profile structure", () => {
  const sender = "a".repeat(56) + ".onion";
  const profile = {
    userId: sender, name: "Имя", avatar:null, status:"custom",
    customStatus:"Статус", updatedAt:1777777777,
  };
  const row = {
    key:"profile::"+sender, chatKey:"remote-profile", messageId:sender,
    updatedAt:profile.updatedAt, data:profile,
  };
  it("accepts portable profiles of the authenticated sender", () => {
    expect(() => validateBackupStructure({...dump(),lifecycle:[row]})).not.toThrow();
  });
  it("rejects remote profile index timestamps that disagree with the signed content", () => {
    expect(() => validateBackupStructure({...dump(), lifecycle:[
      {...row,updatedAt:profile.updatedAt+1},
    ]})).toThrow("Invalid portable remote profile");
  });
  it("rejects foreign-key ciphertext, wrong owner or unsafe avatars", () => {
    for (const bad of [
      {...row,data:{kind:"trivo-remote-profile-sealed-v1",sealed:{}}},
      {...row,key:"profile::other"},
      {...row,data:{...profile,userId:"other"}},
      {...row,data:{...profile,avatar:"https://evil.example"}},
    ]) expect(() => validateBackupStructure({...dump(),lifecycle:[bad]})).toThrow();
  });
});
