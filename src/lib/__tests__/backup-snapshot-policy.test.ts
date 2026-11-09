import { describe, expect, it } from "vitest";
import { assertExportSnapshotSafe, type BackupSnapshotRows } from "../backup-snapshot-policy";

const empty = (): BackupSnapshotRows => ({
  contacts: [], messages: [], outbox: [], lifecycle: [], blobs: [],
});
const smallBlob = (bytes: number, declaredSize: number = bytes) => ({
  fileId: "pic", name: "pic.png", mimeType: "image/png",
  storedAt: 1, size: declaredSize, data: new Blob([new Uint8Array(bytes)]),
});

describe("consistent backup snapshot and actual disk-size preflight", () => {
  it("accepts a coherent snapshot with attached media and tombstones", () => {
    expect(() => assertExportSnapshotSafe({
      ...empty(),
      messages: [{ id: "message", text: "example", media: { fileId:"pic" } }],
      lifecycle: [{ key: "deleted", data: { deleted: true } }],
      blobs: [smallBlob(256)],
    })).not.toThrow();
  });
  it("rejects false Blob metadata rather than silently exporting a corrupt archive", () => {
    expect(() => assertExportSnapshotSafe({
      ...empty(), blobs: [smallBlob(20, 1)],
    })).toThrow(/size differs/);
    expect(() => assertExportSnapshotSafe({
      ...empty(), blobs: [{ ...smallBlob(20), size: -1 }],
    })).toThrow(/size differs/);
  });
  it("does not underestimate long lifecycle/extra message fields", () => {
    const large = "private " + "X".repeat(46 * 1024 * 1024);
    expect(() => assertExportSnapshotSafe({
      ...empty(), lifecycle: [{ key:"long",data:{ editedText:large } }],
    })).toThrow(/too large/);
  });
  it("rejects nonserializable and malformed records instead of creating invalid JSON", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => assertExportSnapshotSafe({
      ...empty(), contacts: [cycle],
    })).toThrow(/nonserializable/);
    expect(() => assertExportSnapshotSafe({
      ...empty(), messages: [{ text: 1n }],
    })).toThrow(/nonserializable/);
  });
});
