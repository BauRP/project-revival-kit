/**
 * Actual Dexie transaction adapters for history encryption.
 * NOT connected to live storage until every direct consumer understands
 * encrypted rows and portable-backup decryption. No crypto awaits inside tx.
 */
import { dxdb, type StoredMessage, type LifecycleRecord } from "./dexie-db";
import { deletedMessageKey, isDeletedMessageRecord, LOCAL_DELETED_CHAT_KEY, messageMediaFileId } from "./message-deletion-policy";
import { consumedMediaKey, isConsumedMediaRecord } from "./one-time-policy";
import { looksLikeProtectedHistoryRow, type ProtectedMessageRecord, type ProtectedLifecycleRecord } from "./protected-history-record";
import type { HistoryRowMigrationIO } from "./history-migration-commit";

/** Changes made during slow encryption must never be overwritten. */
export function sameLegacyHistorySnapshot<T>(live: T | undefined, expected: T): boolean {
  if (!live || typeof live !== "object" || Array.isArray(live) ||
      !expected || typeof expected !== "object" || Array.isArray(expected) ||
      looksLikeProtectedHistoryRow(live) || looksLikeProtectedHistoryRow(expected))
    return false;
  try {
    return JSON.stringify(live) === JSON.stringify(expected) &&
      Object.keys(live).length === Object.keys(expected).length;
  } catch {
    return false;
  }
}

/** Security tombstones and remote synchronization state must not be silently
 * hidden from their existing plain-record readers in a partial migration.
 */
export function isMigratableMessageLifecycle(row: LifecycleRecord): boolean {
  return !!row && typeof row.key === "string" &&
    typeof row.chatKey === "string" && typeof row.messageId === "string" &&
    row.chatKey !== LOCAL_DELETED_CHAT_KEY &&
    row.chatKey !== "consumed-media" &&
    !row.chatKey.startsWith("reaction::") &&
    !row.chatKey.startsWith("history-protection") &&
    !row.chatKey.startsWith("removed-contact") &&
    row.key === `${row.chatKey}::${row.messageId}` &&
    !!row.data && typeof row.data === "object" && !Array.isArray(row.data);
}

/** Explicit opt-in adapter; never call until all message readers are migrated. */
export function createMessageMigrationIO(
  messageId: string,
): HistoryRowMigrationIO<StoredMessage, ProtectedMessageRecord> {
  return {
    async compareAndReplace(expected, sealed) {
      if (messageId !== expected.id || sealed.id !== messageId) return false;
      return dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
        const current = await dxdb.messages.get(messageId);
        if (!sameLegacyHistorySnapshot(current, expected)) return false;
        if (isDeletedMessageRecord(
          (await dxdb.lifecycle.get(deletedMessageKey(messageId)))?.data,
        )) return false;
        const fileId = messageMediaFileId(expected);
        if (fileId && isConsumedMediaRecord(
          (await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data,
        )) return false;
        await dxdb.messages.put(sealed as unknown as StoredMessage);
        return true;
      });
    },
    async readCommitted() {
      return dxdb.messages.get(messageId);
    },
  };
}

/** Only ordinary per-message edit mirrors are eligible for this adapter.
 * It does not migrate deleted-message tombstones or reaction/identity rows.
 */
export function createLifecycleMigrationIO(
  recordKey: string,
): HistoryRowMigrationIO<LifecycleRecord, ProtectedLifecycleRecord> {
  return {
    async compareAndReplace(expected, sealed) {
      if (recordKey !== expected.key || sealed.key !== recordKey ||
          !isMigratableMessageLifecycle(expected)) return false;
      return dxdb.transaction("rw", [dxdb.lifecycle], async () => {
        const current = await dxdb.lifecycle.get(recordKey);
        if (!sameLegacyHistorySnapshot(current, expected)) return false;
        await dxdb.lifecycle.put(sealed as unknown as LifecycleRecord);
        return true;
      });
    },
    async readCommitted() {
      return dxdb.lifecycle.get(recordKey);
    },
  };
}
