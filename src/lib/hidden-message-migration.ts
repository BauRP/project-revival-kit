/**
 * One-shot upgrade for older versions that only hid deleted messages in
 * the UI while leaving their original plaintext/attachment in IndexedDB.
 * The write transaction is idempotent: if power is lost, the next startup
 * retries without recreating an already purged message.
 */
import { dxdb } from "./dexie-db";
import { dbGetStrict, dbPutStrict } from "./storage";
import {
  deletedMessageKey, findUnreferencedMedia, LOCAL_DELETED_CHAT_KEY,
  redactLocalMessage,
} from "./message-deletion-policy";

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

    const ids = new Set(flags.map((entry) => entry.messageId));
    const all = await dxdb.messages.toArray();
    const targets = all.filter((message) => ids.has(message.id));
    const retained = all.filter((message) => !ids.has(message.id));
    const orphaned = findUnreferencedMedia(
      targets.map((message) => ({ media: message.media })),
      retained.map((message) => ({ media: message.media })),
    );
    const now = Date.now();
    for (const message of targets)
      await dxdb.messages.put(redactLocalMessage(message));
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
          remoteUpdatedAt: typeof old.remoteUpdatedAt === "number"
            ? old.remoteUpdatedAt : undefined,
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
    await dxdb.outbox.bulkDelete([...ids]);
    if (orphaned.length) {
      await dxdb.blobs.bulkDelete(orphaned);
      await dxdb.partial_chunks.where("fileId").anyOf(orphaned).delete();
    }
    return { count: targets.length, orphaned };
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
