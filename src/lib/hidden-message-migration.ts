/**
 * One-shot upgrade for older versions that only hid deleted messages in
 * the UI while leaving their original plaintext/attachment in IndexedDB.
 * The write transaction is idempotent: if power is lost, the next startup
 * retries without recreating an already purged message.
 */
import { dxdb } from "./dexie-db";
import { dbGetStrict, dbPutStrict } from "./storage";
import {
  deletedMessageKey, LOCAL_DELETED_CHAT_KEY, messageMediaFileId,
  redactLocalMessage, unreferencedFileIds, boundedRecordBatches,
} from "./message-deletion-policy";
import { queuedReactionEventIds } from "./reaction-deletion-policy";
import { lifecycleRowsToPurgeForDeletedMessages } from "./backup-merge-policy";

const MIGRATION_FLAG = "trivo-private-deletion-v2";

export function isPreviouslyHiddenMessage(
  data: unknown, selfId: string,
): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const item = data as Record<string, unknown>;
  return item.deletedForEveryone === true ||
    (Array.isArray(item.deletedFor) && item.deletedFor.includes(selfId));
}

export async function scrubLegacyHiddenMessageBodies(selfId: string): Promise<number> {
  if (!selfId) throw new Error("Cannot identify the owner of old deleted messages");
  if (await dbGetStrict<boolean>("settings", MIGRATION_FLAG)) return 0;
  const result = await dxdb.transaction("rw", [
    dxdb.messages, dxdb.outbox, dxdb.lifecycle,
    dxdb.blobs, dxdb.partial_chunks,
  ], async () => {
    const flags = await dxdb.lifecycle.filter((entry) =>
      isPreviouslyHiddenMessage(entry.data, selfId) &&
      entry.chatKey !== LOCAL_DELETED_CHAT_KEY &&
      entry.messageId.length > 0 && entry.messageId.length <= 128
    ).toArray();
    if (!flags.length) return { count: 0, orphaned: [] as string[] };

    const ids = [...new Set(flags.map((entry) => entry.messageId))];
    const candidates = new Set<string>();
    let redactedCount = 0;
    const now = Date.now();
    // Do not load every private message, transcript or attachment metadata
    // into WebView RAM at startup. Redact bounded batches in ONE durable
    // write transaction so interruption cannot leave a half-migrated chat.
    for (const batch of boundedRecordBatches(ids)) {
      const rows = await dxdb.messages.bulkGet(batch);
      const redacted = rows.filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => {
          const fileId = messageMediaFileId(row);
          if (fileId) candidates.add(fileId);
          redactedCount++;
          return redactLocalMessage(row);
        });
      if (redacted.length) await dxdb.messages.bulkPut(redacted);
    }
    // Only after redacting, scan remaining live references with a cursor.
    // Shared files survive; orphaned plaintext files and partial chunks go.
    const retained = new Set<string>();
    if (candidates.size) await dxdb.messages.each((row) => {
      const fileId = messageMediaFileId(row);
      if (fileId && candidates.has(fileId)) retained.add(fileId);
    });
    const orphaned = unreferencedFileIds([...candidates], retained);
    // Old releases left a SECOND copy of the deleted content in lifecycle
    // edits and queued signed reaction events. Scrub all per-message mutable
    // state before republishing the tiny safe legacy tombstone.
    for (const batch of boundedRecordBatches(ids)) {
      const related = await dxdb.lifecycle.where("messageId").anyOf(batch).toArray();
      const stale = lifecycleRowsToPurgeForDeletedMessages(
        related, new Set(batch),
      );
      for (const eventBatch of boundedRecordBatches(queuedReactionEventIds(stale)))
        await dxdb.outbox.bulkDelete(eventBatch);
      for (const keyBatch of boundedRecordBatches(stale.map((row) => row.key)))
        await dxdb.lifecycle.bulkDelete(keyBatch);
    }
    for (const entry of flags) {
      // Only the fields required to display a tombstone may survive; old
      // lifecycle edits sometimes contain a second plaintext editedText.
      const old = entry.data;
      await dxdb.lifecycle.put({
        ...entry,
        data: {
          messageId: entry.messageId,
          deletedForEveryone: old.deletedForEveryone === true,
          deletedFor: Array.isArray(old.deletedFor)
            ? old.deletedFor.filter((x): x is string => typeof x === "string")
            : [],
          updatedAt: now,
          remoteUpdatedAt: typeof old.remoteUpdatedAt === "number" &&
            Number.isSafeInteger(old.remoteUpdatedAt) &&
            old.remoteUpdatedAt > 0 ? old.remoteUpdatedAt : undefined,
        },
        updatedAt: now,
      });
      await dxdb.lifecycle.put({
        key: deletedMessageKey(entry.messageId),
        chatKey: LOCAL_DELETED_CHAT_KEY,
        messageId: entry.messageId,
        data: { deleted: true, deletedAt: now }, updatedAt: now,
      });
    }
    for (const batch of boundedRecordBatches(ids))
      await dxdb.outbox.bulkDelete(batch);
    for (const batch of boundedRecordBatches(orphaned)) {
      await dxdb.blobs.bulkDelete(batch);
      await dxdb.partial_chunks.where("fileId").anyOf(batch).delete();
    }
    return { count: redactedCount, orphaned };
  });
  // The flag is written AFTER the entire Dexie transaction commits. If this
  // write fails, rerunning the migration is safe and will not reveal data.
  await dbPutStrict("settings", MIGRATION_FLAG, true);
  if (result.orphaned.length) {
    const { revokeStoredMediaUrls } = await import("./media-store");
    revokeStoredMediaUrls(result.orphaned);
  }
  return result.count;
}
