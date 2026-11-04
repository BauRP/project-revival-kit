import { describe, expect, it } from "vitest";
import { pendingBackupFilename, 
  createDatedBackupFilename, isSafeBackupFilename, newestBackupFilename,
  automaticBackupsToPrune, isAutomaticBackupFilename,
} from "../backup-files";

describe("safe portable backup retention", () => {
  it("creates different, valid manual and auto filenames", () => {
    const day = new Date("2026-11-03T01:20:30.000Z");
    const manual = createDatedBackupFilename(day);
    const auto = createDatedBackupFilename(day, "auto");
    expect(manual).not.toBe(createDatedBackupFilename(day));
    expect(manual).toContain("TrivoBackup-2026-11-03T01-20-30-000Z");
    expect(auto).toContain("TrivoAutoBackup-2026-11-03T01-20-30-000Z");
    expect(isSafeBackupFilename(manual)).toBe(true);
    expect(isSafeBackupFilename(auto)).toBe(true);
    expect(isAutomaticBackupFilename(auto)).toBe(true);
    expect(isAutomaticBackupFilename(manual)).toBe(false);
  });
  it("finds newest by timestamp across both archive prefixes", () => {
    const old = "TrivoBackup-2026-11-01T01-20-30-000Z-00000000.tvc";
    const auto = "TrivoAutoBackup-2026-11-03T01-20-30-000Z-00000000.tvc";
    const next = "TrivoBackup-2026-11-04T01-20-30-000Z-00000000.tvc";
    expect(newestBackupFilename([old,auto,next,"TrivoBackup.tvc"])).toBe(next);
    expect(newestBackupFilename([old,auto])).toBe(auto);
    expect(newestBackupFilename(["TrivoBackup.tvc"])).toBe("TrivoBackup.tvc");
  });
  it("prunes only excess automatic archives and leaves manual exports alone", () => {
    const manual = "TrivoBackup-2026-10-01T01-20-30-000Z-00000000.tvc";
    const copies = Array.from({length: 9}, (_, i) =>
      "TrivoAutoBackup-2026-11-" + String(i+1).padStart(2, "0") + "T01-20-30-000Z-00000000.tvc");
    expect(automaticBackupsToPrune([...copies,manual,"TrivoBackup.tvc"],7))
      .toEqual([copies[1], copies[0]]);
    expect(automaticBackupsToPrune([manual])).toEqual([]);
    expect(isSafeBackupFilename("../TrivoBackup.tvc")).toBe(false);
  });
});

describe("unfinished encrypted backups", () => {
  it("does not allow a pending file to appear as a restorable backup", () => {
    const finished = createDatedBackupFilename(new Date("2026-11-04T05:00:00.000Z"));
    const partial = pendingBackupFilename(finished);
    expect(isSafeBackupFilename(partial)).toBe(false);
    expect(newestBackupFilename([partial])).toBeNull();
    expect(newestBackupFilename([partial, finished])).toBe(finished);
  });
  it("refuses to derive a pending filename from untrusted paths", () => {
    expect(() => pendingBackupFilename("../bad.tvc")).toThrow();
  });
});
