/**
 * Validate the EXACT consistent Dexie backup snapshot before encoding media.
 * A budget sampled in a separate transaction can become stale during writes.
 * Using stored Blob.size (rather than untrusted metadata) prevents a corrupt
 * metadata record from bypassing the archive's memory limit.
 */
import { assertPortableBackupFits } from "./backup-budget";

export interface BackupSnapshotRows {
  contacts: readonly unknown[];
  messages: readonly unknown[];
  outbox: readonly unknown[];
  lifecycle: readonly unknown[];
  blobs: readonly {
    fileId: string;
    size: number;
    data: Blob;
    [key: string]: unknown;
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
  for (const rows of tables) {
    if (!Array.isArray(rows)) throw new Error("Invalid backup snapshot rows");
    for (const row of rows) metadataCodeUnits += measuredCodeUnits(row);
  }
  for (const row of snapshot.blobs) {
    if (!(row.data instanceof Blob) || !Number.isSafeInteger(row.size) ||
        row.size < 0 || row.size !== row.data.size)
      throw new Error("Backup attachment size differs from committed media");
    mediaBytes += row.data.size;
    // Browser/JS JSON serialization of a Blob omits its bytes. Count the
    // metadata separately, then include its actual binary size in the budget.
    const { data: ignored, ...metadata } = row;
    void ignored;
    metadataCodeUnits += measuredCodeUnits(metadata);
  }
  if (!Number.isSafeInteger(metadataCodeUnits) || !Number.isSafeInteger(mediaBytes))
    throw new Error("Backup size exceeds safe numeric range");
  assertPortableBackupFits({
    mediaBytes, textCodeUnits: metadataCodeUnits,
    records: tables.reduce((sum, rows) => sum + rows.length, 0) + snapshot.blobs.length,
  });
}
