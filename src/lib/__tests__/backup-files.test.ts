import { describe, expect, it } from "vitest";
import { createDatedBackupFilename, isSafeBackupFilename, newestBackupFilename } from "../backup-files";
describe("non-destructive portable backup filenames", () => {
  it("creates distinct, filesystem-safe dated backup filenames", () => {
    const date = new Date("2026-11-03T01:20:30.000Z");
    const a = createDatedBackupFilename(date), b = createDatedBackupFilename(date);
    expect(a).not.toBe(b);
    expect(isSafeBackupFilename(a)).toBe(true);
    expect(a).toContain("2026-11-03T01-20-30-000Z");
  });
  it("selects the most recent dated backup, keeping legacy compatibility", () => {
    const old = "TrivoBackup-2026-11-01T01-20-30-000Z-00000000.tvc";
    const next = "TrivoBackup-2026-11-03T01-20-30-000Z-00000000.tvc";
    expect(newestBackupFilename(["notes.txt",old,"TrivoBackup.tvc",next])).toBe(next);
    expect(newestBackupFilename(["TrivoBackup.tvc"])).toBe("TrivoBackup.tvc");
    expect(newestBackupFilename(["notes.txt"])).toBeNull();
  });
  it("never allows traversal, arbitrary files or malformed dates", () => {
    for(const p of ["../TrivoBackup.tvc","other.tvc","/TrivoBackup.tvc","TrivoBackup-foo.tvc"])
      expect(isSafeBackupFilename(p)).toBe(false);
  });
});
