// Dexie.js local database — the only persistent store for the Trivo P2P stack.
// Every peer is keyed by its full `.onion` address.
//   - contacts  : onion → local display name + last seen
//   - messages  : chat messages (single source of truth for message state)
//   - outbox    : sealed (ciphertext-only) frames awaiting a DELIVERED_ACK
//   - inbox_raw : sealed inbound frames not yet committed to `messages`
//   - blobs     : binary payloads keyed by fileId
//   - lifecycle : per-chat edit/delete/pin mirror

import Dexie, { type Table } from "dexie";
import { consumedMediaKey, isConsumedMediaRecord, isProtectedByConsumedTombstone, sanitizeRestoredOneTimeMessage } from "./one-time-policy";
import { validateBackupStructure } from "./backup-validation";
import { stripSessionMediaUrl } from "./backup-media-policy";
import { lifecycleRowsForRestore, lifecycleRowsToPurgeForDeletedMessages } from "./backup-merge-policy";
import { queuedReactionEventIds } from "./reaction-deletion-policy";
import { assertPortableBackupFits } from "./backup-budget";
import { deletedMessageKey, isDeletedMessageRecord, LOCAL_DELETED_CHAT_KEY, findUnreferencedMedia, unusedBackupMedia, matchesReceivedAttachmentMetadata } from "./message-deletion-policy";
import { canEvictUnreferencedMedia, isMatchingReceivedCache } from "./media-cache-policy";

export interface ContactRecord {
  onion: string;
  displayName?: string;
  lastSeen?: number;
  addedAt: number;
}

export type OutboxKind =
  | "text_message"
  | "friend_request"
  | "friend_request_status"
  | "message_status"
  | "message_lifecycle";

export interface OutboxRecord {
  /** Payload id — identical to the message id for text messages. */
  id: string;
  peer: string;
  kind: OutboxKind;
  /** Sealed frame JSON (ciphertext only). */
  frame: string;
  /** pending = never shipped, sent = reached remote socket, failed = last attempt failed. */
  status: "pending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface InboxRawRecord {
  id: string;
  raw: string;
  receivedAt: number;
}

export interface StoredMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  status: "pending" | "sent" | "delivered" | "read";
  [key: string]: unknown;
}

export interface BlobRecord {
  fileId: string;
  mimeType: string;
  name: string;
  size: number;
  data: Blob;
  storedAt: number;
  /**
   * Only verified received-cache files may be evicted. Locally uploaded or
   * old pre-origin-tag records may be the user's sole surviving copy.
   */
  origin?: "local" | "received";
}

export interface LifecycleRecord {
  key: string;
  chatKey: string;
  messageId: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

/** Persistent incomplete chunks. Data is private app storage; cleanup on completion. */
export interface PartialBlobChunkRecord {
  key: string;
  fileId: string;
  from: string;
  index: number;
  totalChunks: number;
  name: string;
  mimeType: string;
  digest: string;
  data: Blob;
  /** Android AES-GCM sealed fragment; old records omit these fields. */
  encrypted?: 1;
  plaintextSize?: number;
  updatedAt: number;
}

class TrivoDexie extends Dexie {
  contacts!: Table<ContactRecord, string>;
  messages!: Table<StoredMessage, string>;
  outbox!: Table<OutboxRecord, string>;
  inbox_raw!: Table<InboxRawRecord, string>;
  blobs!: Table<BlobRecord, string>;
  lifecycle!: Table<LifecycleRecord, string>;
  partial_chunks!: Table<PartialBlobChunkRecord, string>;

  constructor() {
    super("trivo-p2p");
    this.version(3).stores({
      contacts: "&userId, updatedAt, lastSeen, onionAddress",
      pending_messages: "&id, targetUserId, status, createdAt",
      blobs: "&fileId, storedAt, size",
      lifecycle: "&key, chatKey, messageId, updatedAt",
    });
    // v4 drops the userId-keyed directory and the plaintext pending queue.
    this.version(4).stores({ contacts: null, pending_messages: null });
    // v5 re-creates contacts keyed by onion and adds the transactional tables.
    this.version(5).stores({
      contacts: "&onion, lastSeen",
      messages: "&id, from, to, timestamp",
      outbox: "&id, peer, status, nextAttemptAt, createdAt",
      inbox_raw: "&id, receivedAt",
      blobs: "&fileId, storedAt, size",
      lifecycle: "&key, chatKey, messageId, updatedAt",
    });
    // v6 adds incomplete media chunks without touching existing user records.
    this.version(6).stores({
      partial_chunks: "&key, fileId, from, updatedAt",
    });
  }
}

export const dxdb = new TrivoDexie();

// ─── Contacts (onion → display name) ──────────────────────────

export async function upsertContact(onion: string, displayName?: string): Promise<void> {
  if (!onion) return;
  const existing = await dxdb.contacts.get(onion);
  await dxdb.contacts.put({
    onion,
    displayName: displayName ?? existing?.displayName,
    lastSeen: existing?.lastSeen,
    addedAt: existing?.addedAt ?? Date.now(),
  });
}

export async function setContactLastSeen(onion: string, ts: number = Date.now()): Promise<void> {
  if (!onion) return;
  // A signed incoming frame proves the sender owns that .onion, NOT that
  // the user accepted them as a contact. Unknown senders must never acquire
  // contact privileges merely by pinging the transport.
  await dxdb.contacts.where("onion").equals(onion).modify({ lastSeen: ts });
}

export async function getAllContacts(): Promise<ContactRecord[]> {
  return dxdb.contacts.toArray();
}

export async function getContactLastSeen(onion: string): Promise<number | null> {
  const rec = await dxdb.contacts.get(onion);
  return rec?.lastSeen ?? null;
}

// ─── Blob store ───────────────────────────────────────────────

export async function putBlob(
  fileId: string,
  data: Blob,
  name: string,
  mimeType: string,
): Promise<void> {
  // Serialize with the one-time purge so an in-flight download cannot
  // recreate revoked media after the viewer has consumed it.
  await dxdb.transaction("rw", [dxdb.lifecycle, dxdb.blobs], async () => {
    if (isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data))
      throw new Error("One-time attachment already viewed");
    await dxdb.blobs.put({
      fileId,
      mimeType: mimeType || data.type || "application/octet-stream",
      name: name || `file-${fileId}`,
      size: data.size,
      data,
      storedAt: Date.now(),
      origin: "local",
    });
  });
  // Opportunistic cache enforcement (non-blocking, errors swallowed).
  void enforceMediaCacheLimit().catch(() => undefined);
}

/**
 * Commit received Tor media only while a non-deleted message from that
 * authenticated peer still references it. This check shares one IndexedDB
 * transaction with the write: a deletion cannot race between the check and
 * the write and silently recreate an already removed attachment.
 */
export async function putReceivedBlob(
  fileId: string, data: Blob, name: string, mimeType: string,
  sender: string, recipient: string,
): Promise<boolean> {
  const saved = await dxdb.transaction("rw",
    [dxdb.messages, dxdb.lifecycle, dxdb.blobs], async () => {
      if (isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data))
        return false;
      // Stop at the first metadata-matching signed parent message rather
      // than materializing an entire peer's chat (including long text and
      // media objects) for each received attachment.
      const parents = await dxdb.messages.where("from").equals(sender)
        .filter((msg) => matchesReceivedAttachmentMetadata(
          msg, sender, recipient, fileId, name, mimeType, data.size,
        )).toArray();
      // Multiple messages can reference the same attachment. An earlier
      // locally deleted reference must not prevent the live reference from
      // accepting its signed media. Only matching parents are materialized.
      for (const parent of parents) {
        if (isDeletedMessageRecord((await dxdb.lifecycle.get(deletedMessageKey(parent.id)))?.data))
          continue;
        const incomingMeta = {
          name: name || `file-${fileId}`,
          mimeType: mimeType || data.type || "application/octet-stream",
          size: data.size,
        };
        const existing = await dxdb.blobs.get(fileId);
        if (existing) {
          // Signed peer media must never overwrite the user's local upload
          // (or an older unknown-origin blob). Duplicate received frames
          // may reuse only the same previously validated metadata.
          return isMatchingReceivedCache(existing, incomingMeta);
        }
        await dxdb.blobs.add({
          fileId, ...incomingMeta, data, storedAt: Date.now(),
          origin: "received",
        });
        return true;
      }
      return false;
    });
  if (saved) void enforceMediaCacheLimit().catch(() => undefined);
  return saved;
}

export async function getBlob(fileId: string): Promise<BlobRecord | undefined> {
  // Read the revocation marker and file from one database snapshot. Older
  // cached attachments must not be served after a one-time view.
  return dxdb.transaction("r", [dxdb.lifecycle, dxdb.blobs], async () => {
    if (isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data))
      return undefined;
    return dxdb.blobs.get(fileId);
  });
}

export async function hasBlob(fileId: string): Promise<boolean> {
  return dxdb.transaction("r", [dxdb.lifecycle, dxdb.blobs], async () => {
    if (isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data))
      return false;
    return (await dxdb.blobs.where("fileId").equals(fileId).count()) > 0;
  });
}

// ─── Lifecycle mirror ─────────────────────────────────────────

export async function putLifecycle(
  chatKey: string,
  messageId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dxdb.lifecycle.put({
    key: `${chatKey}::${messageId}`,
    chatKey,
    messageId,
    data,
    updatedAt: Date.now(),
  });
}

export async function getLifecycleMap(
  chatKey: string,
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await dxdb.lifecycle.where("chatKey").equals(chatKey).toArray();
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) out[r.messageId] = r.data;
  return out;
}

// ─── Smart media cache cleanup (3 GB ceiling) ────────────────

/** Hard ceiling: 3 GiB of stored media triggers truncation. */
export const MEDIA_CACHE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;

export async function getTotalBlobBytes(): Promise<number> {
  let total = 0;
  await dxdb.blobs.each((row) => {
    total += row.size || 0;
  });
  return total;
}

/**
 * If stored media reaches the cache ceiling, reclaim oldest unreferenced
 * files until below the limit. Never evict a file still used by a message.
 * Returns the number of deleted files; if every blob is referenced the cache
 * may remain above the limit to avoid destructive data loss.
 */
export async function enforceMediaCacheLimit(
  limitBytes: number = MEDIA_CACHE_LIMIT_BYTES,
): Promise<number> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1)
    throw new Error("Invalid media cache limit");
  // A message can be attached between checking references and deleting a
  // previously unreferenced Blob. Both the reference snapshot and the delete
  // MUST share one IndexedDB transaction to prevent accidental data loss.
  return dxdb.transaction("rw", [dxdb.messages, dxdb.blobs], async () => {
    let total = 0;
    const referenced = new Set<string>();
    await dxdb.messages.each((message) => {
      const media = message.media as { fileId?: string } | undefined;
      if (typeof media?.fileId === "string") referenced.add(media.fileId);
    });
    await dxdb.blobs.each((record) => {
      if (Number.isFinite(record.size) && record.size > 0) total += record.size;
    });
    if (total < limitBytes) return 0;

    const now = Date.now();
    const victims: string[] = [];
    let freed = 0;
    // Don't allocate all media payloads in a separate JS array. A cursor
    // exposes only one Blob at a time; collect small identifiers for deletion.
    await dxdb.blobs.orderBy("storedAt").each((record) => {
      if (total - freed < limitBytes ||
          !canEvictUnreferencedMedia(record, referenced, now)) return;
      victims.push(record.fileId);
      if (Number.isFinite(record.size) && record.size > 0) freed += record.size;
    });
    if (victims.length) await dxdb.blobs.bulkDelete(victims);
    return victims.length;
  });
}

/**
 * An upload can be cancelled AFTER its durable Blob commit. Another task
 * could already have attached its fileId to a message. Removing that file
 * without checking references would corrupt a sent message. Serialize the
 * cancellation check with all message writes.
 */
export async function discardUnreferencedUpload(fileId: string): Promise<boolean> {
  if (!fileId) throw new Error("Missing uploaded file ID");
  return dxdb.transaction("rw", [dxdb.messages, dxdb.blobs], async () => {
    const references = await dxdb.messages.filter((message) => {
      const media = message.media as { fileId?: unknown } | undefined;
      return media?.fileId === fileId;
    }).count();
    if (references > 0) return false;
    await dxdb.blobs.delete(fileId);
    return true;
  });
}

let cacheMonitorTimer: ReturnType<typeof setInterval> | null = null;

/** Start a background watchdog that re-checks the cache every 5 minutes. */
export function startMediaCacheMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (cacheMonitorTimer) return;
  cacheMonitorTimer = setInterval(() => {
    void enforceMediaCacheLimit().catch(() => undefined);
  }, intervalMs);
}

export function stopMediaCacheMonitor(): void {
  if (cacheMonitorTimer) {
    clearInterval(cacheMonitorTimer);
    cacheMonitorTimer = null;
  }
}

// ─── Backup / restore dumps ──────────────────────────────────

export interface DexieDump {
  schemaVersion: 3;
  createdAt: number;
  contacts: ContactRecord[];
  messages: StoredMessage[];
  outbox: OutboxRecord[];
  lifecycle: LifecycleRecord[];
  /** Blobs are base64-encoded so the dump can live as a single JSON string. */
  blobs: Array<Omit<BlobRecord, "data"> & { dataB64: string }>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(buf.subarray(i, i + CHUNK)) as unknown as number[],
    );
  }
  return btoa(s);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
}

/**
 * The current JSON-based portable format cannot encode gigabyte blobs.
 * Estimate a conservative bound before loading or base64-encoding them.
 */
async function assertExportPreflight(): Promise<void> {
  const [contacts, messages, outbox, lifecycle, blobs] = await Promise.all([
    dxdb.contacts.count(), dxdb.messages.count(), dxdb.outbox.count(),
    dxdb.lifecycle.count(), dxdb.blobs.count(),
  ]);
  let mediaBytes = 0;
  let textCodeUnits = 0;
  await Promise.all([
    dxdb.blobs.each((r) => { mediaBytes += r.size || 0; }),
    dxdb.messages.each((r) => { textCodeUnits += r.text?.length || 0; }),
  ]);
  assertPortableBackupFits({
    mediaBytes, textCodeUnits,
    records: contacts + messages + outbox + lifecycle + blobs,
  });
}

export async function exportDexieDump(): Promise<DexieDump> {
  await assertExportPreflight();
  const [contacts, messages, outbox, lifecycle, blobs] = await Promise.all([
    dxdb.contacts.toArray(),
    dxdb.messages.toArray(),
    dxdb.outbox.toArray(),
    dxdb.lifecycle.toArray(),
    dxdb.blobs.toArray(),
  ]);
  // Avoid starting a separate multi-megabyte ArrayBuffer conversion for
  // every attachment at once. Sequential encoding limits peak native and
  // WebView memory while preserving the exact V3 portable archive format.
  const blobsEncoded: DexieDump["blobs"] = [];
  for (const b of blobs) {
    blobsEncoded.push({
      fileId: b.fileId,
      mimeType: b.mimeType,
      name: b.name,
      size: b.size,
      storedAt: b.storedAt,
      dataB64: await blobToBase64(b.data),
    });
  }
  return {
    schemaVersion: 3,
    createdAt: Date.now(),
    contacts,
    messages: messages.map(stripSessionMediaUrl),
    outbox,
    lifecycle,
    blobs: blobsEncoded,
  };
}

export async function importDexieDump(dump: DexieDump): Promise<void> {
  validateBackupStructure(dump);
  await dxdb.transaction(
    "rw",
    [dxdb.contacts, dxdb.messages, dxdb.outbox, dxdb.lifecycle, dxdb.blobs, dxdb.partial_chunks],
    async () => {
      // Non-destructive restore: current conversations, contacts and attachments
      // must never be erased just because an older backup was imported.
      // The local consumed-media tombstone is authoritative. An older backup
      // must never restore one-time files or their message previews.
      const currentTombstones = await dxdb.lifecycle.where("chatKey").equals("consumed-media").toArray();
      const restoredTombstones = (dump.lifecycle || []).filter((row) =>
        row?.chatKey === "consumed-media" && isConsumedMediaRecord(row.data) &&
        row.key === consumedMediaKey(row.messageId));
      const revoked = new Set([
        ...currentTombstones.filter((row) => isConsumedMediaRecord(row.data)).map((row) => row.key),
        ...restoredTombstones.map((row) => row.key),
      ]);
      // Existing contact names and preferences take priority over older backups.
      const currentContacts = new Set(await dxdb.contacts.toCollection().primaryKeys());
      await dxdb.contacts.bulkPut((dump.contacts || []).filter((c) => !currentContacts.has(c.onion)));
      const presentIds = new Set(await dxdb.messages.toCollection().primaryKeys());
      const currentDeleted = await dxdb.lifecycle.where("chatKey").equals(LOCAL_DELETED_CHAT_KEY).toArray();
      const restoredDeleted = (dump.lifecycle || []).filter((row) =>
        row?.chatKey === LOCAL_DELETED_CHAT_KEY && isDeletedMessageRecord(row.data) &&
        row.key === deletedMessageKey(row.messageId));
      const deletedIds = new Set([
        ...currentDeleted.filter((r) => isDeletedMessageRecord(r.data)).map((r) => r.messageId),
        ...restoredDeleted.map((r) => r.messageId),
      ]);
      await dxdb.messages.bulkPut((dump.messages || []).filter((m) =>
        !presentIds.has(m.id) && !deletedIds.has(m.id))
        .map((m) => sanitizeRestoredOneTimeMessage(stripSessionMediaUrl(m), revoked)));
      // Do NOT re-activate encrypted frames from an older backup. Those
      // ciphertexts may belong to a deleted identity, and automatically
      // resending them could replay an old message or privacy-sensitive edit.
      // The current live outbox is preserved by this merge operation.
      // Historic unsent frames remain in the encrypted backup for audit only.
      const lifecycleIds = new Set(await dxdb.lifecycle.toCollection().primaryKeys());
      // Restored irreversible tombstones take precedence over older local
      // lifecycle rows with the same key. Otherwise a consumed file could
      // reappear after restart despite being purged during this restore.
      await dxdb.lifecycle.bulkPut(lifecycleRowsForRestore(dump.lifecycle || [], lifecycleIds));

      // A deleted-message tombstone restored from an older backup is still
      // authoritative against a message already present on this device.
      // The previous importer only filtered NEW backup rows; it could leave
      // an existing plaintext message visible despite a restored deletion.
      const existingDeleted = deletedIds.size
        ? await dxdb.messages.where("id").anyOf([...deletedIds]).toArray()
        : [];
      const remaining = existingDeleted.length
        ? await dxdb.messages.filter((m) => !deletedIds.has(m.id)).toArray()
        : [];
      const orphaned = findUnreferencedMedia(
        existingDeleted.map((message) => ({ media: message.media })),
        remaining.map((message) => ({ media: message.media })),
      );
      if (existingDeleted.length) await dxdb.messages.bulkDelete(existingDeleted.map((m) => m.id));
      if (deletedIds.size) {
        await dxdb.outbox.bulkDelete([...deletedIds]);
        // Backup merge can restore an old "edit" or reaction beside a newer
        // deletion tombstone. Erase mutable lifecycle plaintext and cancel
        // queued reaction events in the same all-tables restore transaction.
        // Otherwise a reconnect may resend a reaction for a deleted message.
        const lifecycleRows = await dxdb.lifecycle.where("messageId")
          .anyOf([...deletedIds]).toArray();
        const stale = lifecycleRowsToPurgeForDeletedMessages(lifecycleRows, deletedIds);
        const pendingReactionIds = queuedReactionEventIds(stale);
        if (pendingReactionIds.length)
          await dxdb.outbox.bulkDelete(pendingReactionIds);
        if (stale.length) await dxdb.lifecycle.bulkDelete(stale.map((r) => r.key));
      }
      if (orphaned.length) {
        await dxdb.blobs.bulkDelete(orphaned);
        await dxdb.partial_chunks.where("fileId").anyOf(orphaned).delete();
      }

      const surviving = await dxdb.messages.toArray();
      const deniedBackupMedia = new Set([
        ...orphaned,
        ...unusedBackupMedia(
          dump.messages || [], deletedIds,
          surviving.map((message) => ({ media: message.media })),
        ),
      ]);
      // Filter BEFORE Base64 decoding. A removed 100 MB attachment should
      // never be recreated in memory merely to discard it after import.
      const existingBlobIds = new Set(await dxdb.blobs.toCollection().primaryKeys());
      // Decode and persist each attachment individually inside the SAME
      // atomic restore transaction. The former array map constructed every
      // recovered Blob at once, multiplying peak WebView memory use and
      // crashing some devices on otherwise valid medium-sized backups.
      for (const b of dump.blobs || []) {
        if (existingBlobIds.has(b.fileId) ||
            deniedBackupMedia.has(b.fileId) ||
            isProtectedByConsumedTombstone(b.fileId, revoked)) continue;
        await dxdb.blobs.put({
          fileId: b.fileId, mimeType: b.mimeType, name: b.name,
          size: b.size, storedAt: b.storedAt,
          data: base64ToBlob(b.dataB64, b.mimeType),
        });
      }
      // Reconcile already-present messages too: the restored tombstone is
      // authoritative even when an older local message still references media.
      for (const key of revoked) {
        const fileId = key.slice("consumed-media::".length);
        await dxdb.blobs.delete(fileId);
        await dxdb.partial_chunks.where("fileId").equals(fileId).delete();
        const affected = await dxdb.messages.filter((m) => {
          const media = m.media as { fileId?: string } | undefined;
          return media?.fileId === fileId;
        }).toArray();
        for (const msg of affected)
          await dxdb.messages.put(sanitizeRestoredOneTimeMessage(msg, revoked));
      }
    },
  );
}
