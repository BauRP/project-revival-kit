/** Reject untrusted browser archives before File.text() allocates their bytes.
 * Keep the existing V1/V2 input limit unchanged for backward compatibility.
 */
export const MAX_BACKUP_FILE_BYTES = 360 * 1024 * 1024;
export function assertBackupFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BACKUP_FILE_BYTES)
    throw new Error("Backup file exceeds supported size");
}
