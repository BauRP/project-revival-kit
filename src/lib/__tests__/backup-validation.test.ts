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
