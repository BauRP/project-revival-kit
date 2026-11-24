/**
 * Validate the EXACT consistent Dexie backup snapshot before encoding media.
 * A budget sampled in a separate transaction can become stale during writes.
 * Using stored Blob.size (rather than untrusted metadata) prevents a corrupt
 * metadata record from bypassing the archive's memory limit.
 */
import { assertPortableBackupFits } from "./backup-budget";
import { looksLikeProtectedHistoryRow } from "./protected-history-record";
import { validBlobFileId } from "./blob-request-policy";

export interface BackupSnapshotRows {
  contacts: readonly unknown[];
  messages: readonly unknown[];
  outbox: readonly unknown[];
  lifecycle: readonly unknown[];
  blobs: readonly {
    fileId: string;
    size: number;
    data: Blob;
    name: string;
    mimeType: string;
    storedAt: number;
    origin?: "local" | "received";
  }[];
}

function measuredCodeUnits(item: unknown): number {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(item); }
  catch { throw new Error("Backup contains a nonserializable record"); }
  if (typeof serialized !== "string")
    throw new Error("Backup contains a nonserializable record");
  return serialized.length;
}

/** Fail before allocating duplicate Base64 copies for all private media. */
export function assertExportSnapshotSafe(snapshot: BackupSnapshotRows): void {
  let mediaBytes = 0;
  let metadataCodeUnits = 0;
  const tables = [snapshot.contacts,snapshot.messages,snapshot.outbox,snapshot.lifecycle];
  if ([...tables, snapshot.blobs].some((rows) => !Array.isArray(rows)))
    throw new Error("Invalid backup snapshot rows");
  const records = tables.reduce((sum, rows) => sum + rows.length, 0) + snapshot.blobs.length;
  // Reject pathological record counts BEFORE JSON.stringify can lock the UI.
  assertPortableBackupFits({ mediaBytes: 0, textCodeUnits: 0, records });
  for (const rows of tables) {
    for (const row of rows) {
      // Password-encrypted portable backups MUST NOT contain device-bound
      // ciphertext whose Keystore key cannot travel to another phone.
      // Once history at-rest migration is enabled, the export adapter must
      // decrypt and validate those rows before reaching this snapshot.
      // Refuse a partial/hybrid backup instead of silently losing messages.
      if (looksLikeProtectedHistoryRow(row))
        throw new Error("Device-bound history requires portable decryption before backup");
      metadataCodeUnits += measuredCodeUnits(row);
      // Stop at the first overflowing row instead of serializing the entire history.
      assertPortableBackupFits({ mediaBytes, textCodeUnits: metadataCodeUnits, records });
    }
  }
  for (const row of snapshot.blobs) {
    if (!(row.data instanceof Blob) || !Number.isSafeInteger(row.size) ||
        row.size < 0 || row.size !== row.data.size)
      throw new Error("Backup attachment size differs from committed media");
    // Validate file metadata BEFORE copying the Blob to a Base64 archive.
    // A corrupt legacy record must not cause work on an unusable backup.
    if (!validBlobFileId(row.fileId) ||
        typeof row.name !== "string" || !row.name || row.name.length > 255 ||
        /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(row.name) ||
        typeof row.mimeType !== "string" || !row.mimeType || row.mimeType.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(row.mimeType) ||
        !Number.isSafeInteger(row.storedAt) || row.storedAt < 0)
      throw new Error("Invalid backup attachment metadata");
    mediaBytes += row.data.size;
    // Browser/JS JSON serialization of a Blob omits its bytes. Count the
    // metadata separately, then include its actual binary size in the budget.
    const { data: ignored, ...metadata } = row;
    void ignored;
    metadataCodeUnits += measuredCodeUnits(metadata);
    assertPortableBackupFits({ mediaBytes, textCodeUnits: metadataCodeUnits, records });
  }
  if (!Number.isSafeInteger(metadataCodeUnits) || !Number.isSafeInteger(mediaBytes))
    throw new Error("Backup size exceeds safe numeric range");
}
