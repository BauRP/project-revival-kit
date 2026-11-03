import { describe, expect, it } from "vitest";
import {
  assertPortableBackupFits, estimatedPortableBackupJsonBytes,
  MAX_ESTIMATED_BACKUP_JSON_BYTES,
} from "../backup-budget";

describe("portable backup memory and format preflight", () => {
  it("permits ordinary messages and small encrypted attachments", () => {
    expect(() => assertPortableBackupFits({
      mediaBytes: 250_000, textCodeUnits: 12_000, records: 400,
    })).not.toThrow();
  });
  it("rejects gigabyte media before allocating its base64 duplicate", () => {
    expect(() => assertPortableBackupFits({
      mediaBytes: 1024 ** 3, textCodeUnits: 0, records: 2,
    })).toThrow(/too large/);
  });
  it("accounts conservatively for unicode, record metadata and base64", () => {
    const small = estimatedPortableBackupJsonBytes({
      mediaBytes: 20, textCodeUnits: 10, records: 3,
    });
    expect(small).toBeGreaterThan(4 * 1024 * 1024);
    expect(small).toBeLessThan(MAX_ESTIMATED_BACKUP_JSON_BYTES);
    expect(() => assertPortableBackupFits({
      mediaBytes: 0, textCodeUnits: 75_000_000, records: 1,
    })).toThrow(/too large/);
  });
  it("rejects corrupt counts instead of silently underestimating", () => {
    expect(() => estimatedPortableBackupJsonBytes({
      mediaBytes: NaN, textCodeUnits: 1, records: 1,
    })).toThrow();
  });
});
