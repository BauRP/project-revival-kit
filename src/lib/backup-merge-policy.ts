/**
 * Portable recovery must be a monotonic merge for irreversible privacy events.
 * An older local lifecycle row must never override a restored deletion or a
 * consumed one-time media marker, even when both have the same primary key.
 * Ordinary profile/edit/pin state still prefers this device's current value.
 */
import { consumedMediaKey, isConsumedMediaRecord } from "./one-time-policy";
import { deletedMessageKey, isDeletedMessageRecord, LOCAL_DELETED_CHAT_KEY } from "./message-deletion-policy";

export interface BackupLifecycleRow {
  key: string;
  chatKey: string;
  messageId: string;
  data: Record<string, unknown>;
}

export function isIrreversiblePrivacyMarker(row: BackupLifecycleRow): boolean {
  if (row.chatKey === "consumed-media" && isConsumedMediaRecord(row.data)) {
    try { return row.key === consumedMediaKey(row.messageId); }
    catch { return false; }
  }
  if (row.chatKey === LOCAL_DELETED_CHAT_KEY && isDeletedMessageRecord(row.data)) {
    try { return row.key === deletedMessageKey(row.messageId); }
    catch { return false; }
  }
  return false;
}

/**
 * Preserve existing keys except when the imported record establishes an
 * irreversible deletion. The resulting rows are committed in the same Dexie
 * transaction as the corresponding message and media removal.
 */
export function lifecycleRowsForRestore<T extends BackupLifecycleRow>(
  restored: readonly T[], existingKeys: ReadonlySet<string>,
): T[] {
  return restored.filter((row) => !existingKeys.has(row.key) ||
    isIrreversiblePrivacyMarker(row));
}
