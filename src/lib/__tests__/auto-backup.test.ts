import { describe, expect, it } from "vitest";
import { AUTO_BACKUP_INTERVAL_MS, shouldRunAutomaticBackup, shouldDelayAutomaticBackupRetry } from "../auto-backup";

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

// Failure retry is not a substitute for the daily schedule; it only throttles
// repeated expensive attempts after a real error.
describe("automatic backup failure retry after clock changes", () => {
  it("throttles a recent failure but retries when the clock goes backwards", () => {
    const now=1_800_000_000_000;
    expect(shouldDelayAutomaticBackupRetry(now-1_000,now)).toBe(true);
    expect(shouldDelayAutomaticBackupRetry(now-20*60_000,now)).toBe(false);
    expect(shouldDelayAutomaticBackupRetry(now+24*60*60_000,now)).toBe(false);
    expect(shouldDelayAutomaticBackupRetry(NaN,now)).toBe(false);
  });
});
