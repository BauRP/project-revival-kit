/**
 * Version 2 portable archives are a single JSON/AES-GCM buffer. Catch
 * impossible-to-export databases before reading huge Blobs into memory.
 * Limits are intentionally below the 256 MiB encoded-ciphertext ceiling,
 * leaving room for envelope metadata and JSON overhead.
 */
export interface BackupBudget {
  mediaBytes: number;
  textCodeUnits: number;
  records: number;
}
export const MAX_ESTIMATED_BACKUP_JSON_BYTES = 175 * 1024 * 1024;
export const MAX_PORTABLE_BACKUP_RECORDS = 300_000;
export function estimatedPortableBackupJsonBytes(input: BackupBudget): number {
  const { mediaBytes, textCodeUnits, records } = input;
  if (![mediaBytes,textCodeUnits,records].every((n)=>Number.isSafeInteger(n) && n>=0))
    throw new Error("Invalid portable backup size estimate");
  // Worst-case 4 UTF-8 bytes per code unit; 4/3 for Base64; and 384 bytes
  // JSON framing overhead per row. Leave a 4 MiB reserved margin.
  return Math.ceil(mediaBytes / 3) * 4 +
    textCodeUnits * 4 + records * 384 + 4 * 1024 * 1024;
}
export function assertPortableBackupFits(input: BackupBudget): void {
  if (input.records > MAX_PORTABLE_BACKUP_RECORDS ||
      estimatedPortableBackupJsonBytes(input) > MAX_ESTIMATED_BACKUP_JSON_BYTES)
    throw new Error(
      "Backup is too large for the current portable archive format; remove or export some media separately before retrying",
    );
}
