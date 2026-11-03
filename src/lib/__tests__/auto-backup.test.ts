import { describe, expect, it } from "vitest";
import { AUTO_BACKUP_INTERVAL_MS, shouldRunAutomaticBackup } from "../auto-backup";

describe("opt-in local backup schedule", () => {
  it("never performs repeated expensive exports before the daily interval", () => {
    const now = 1_800_000_000_000;
    expect(shouldRunAutomaticBackup(now, now)).toBe(false);
    expect(shouldRunAutomaticBackup(now, now + AUTO_BACKUP_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRunAutomaticBackup(now, now + AUTO_BACKUP_INTERVAL_MS)).toBe(true);
  });
  it("rejects broken saved timestamps", () => {
    expect(shouldRunAutomaticBackup(NaN)).toBe(false);
    expect(shouldRunAutomaticBackup(-1)).toBe(false);
  });
});

describe("automatic backup across Android clock corrections", () => {
  it("resumes after an incorrect future system clock is corrected", () => {
    const now = 1_800_000_000_000;
    expect(shouldRunAutomaticBackup(now + 24 * 60 * 60_000, now)).toBe(true);
    expect(shouldRunAutomaticBackup(now + 30_000, now)).toBe(false);
    expect(shouldRunAutomaticBackup(now, NaN)).toBe(false);
  });
});
