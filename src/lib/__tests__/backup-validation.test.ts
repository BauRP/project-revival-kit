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

  it("checks exact decoded attachment size and canonical padding", () => {
    for (const invalid of [
      blob(3, "AQ=="), // much shorter than the advertised attachment
      blob(1, "AQID"), // larger than the advertised attachment
      blob(1, "AAAA"), // missing the required padding
      blob(3, "malformed_"), blob(0, "AA=="),
    ]) expect(() => validateBackupStructure({ ...dump(), blobs: [invalid] })).toThrow();
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
