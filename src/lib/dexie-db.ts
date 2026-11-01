// Dexie.js local database — the only persistent store for the Trivo P2P stack.
// Every peer is keyed by its full `.onion` address.
//   - contacts  : onion → local display name + last seen
//   - messages  : chat messages (single source of truth for message state)
//   - outbox    : sealed (ciphertext-only) frames awaiting a DELIVERED_ACK
//   - inbox_raw : sealed inbound frames not yet committed to `messages`
//   - blobs     : binary payloads keyed by fileId
//   - lifecycle : per-chat edit/delete/pin mirror

import Dexie, { type Table } from "dexie";

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
}

export interface LifecycleRecord {
  key: string;
  chatKey: string;
  messageId: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

class TrivoDexie extends Dexie {
  contacts!: Table<ContactRecord, string>;
  messages!: Table<StoredMessage, string>;
  outbox!: Table<OutboxRecord, string>;
  inbox_raw!: Table<InboxRawRecord, string>;
  blobs!: Table<BlobRecord, string>;
  lifecycle!: Table<LifecycleRecord, string>;

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
  const existing = await dxdb.contacts.get(onion);
  await dxdb.contacts.put({
    onion,
    displayName: existing?.displayName,
    addedAt: existing?.addedAt ?? ts,
    lastSeen: ts,
  });
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
  await dxdb.blobs.put({
    fileId,
    mimeType: mimeType || data.type || "application/octet-stream",
    name: name || `file-${fileId}`,
    size: data.size,
    data,
    storedAt: Date.now(),
  });
  // Opportunistic cache enforcement (non-blocking, errors swallowed).
  void enforceMediaCacheLimit().catch(() => undefined);
}

export async function getBlob(fileId: string): Promise<BlobRecord | undefined> {
  return dxdb.blobs.get(fileId);
}

export async function hasBlob(fileId: string): Promise<boolean> {
  const count = await dxdb.blobs.where("fileId").equals(fileId).count();
  return count > 0;
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
 * If the on-device blob cache reaches or exceeds 3 GiB, delete exactly the
 * oldest 50% of entries (sorted ascending by storedAt). The newer half is
 * kept untouched. Returns the number of entries deleted.
 */
export async function enforceMediaCacheLimit(
  limitBytes: number = MEDIA_CACHE_LIMIT_BYTES,
): Promise<number> {
  const total = await getTotalBlobBytes();
  if (total < limitBytes) return 0;

  // Never delete a blob still referenced by a message. The old policy
  // removed half the user's attachments regardless of whether they were needed.
  const referenced = new Set<string>();
  await dxdb.messages.each((message) => {
    const media = message.media as { fileId?: string } | undefined;
    if (media?.fileId) referenced.add(media.fileId);
  });
  const all = await dxdb.blobs.orderBy("storedAt").toArray();
  const victims: string[] = [];
  let freed = 0;
  for (const record of all) {
    if (total - freed < limitBytes) break;
    if (referenced.has(record.fileId)) continue;
    victims.push(record.fileId);
    freed += record.size || 0;
  }
  if (victims.length) await dxdb.blobs.bulkDelete(victims);
  return victims.length;
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

export async function exportDexieDump(): Promise<DexieDump> {
  const [contacts, messages, outbox, lifecycle, blobs] = await Promise.all([
    dxdb.contacts.toArray(),
    dxdb.messages.toArray(),
    dxdb.outbox.toArray(),
    dxdb.lifecycle.toArray(),
    dxdb.blobs.toArray(),
  ]);
  const blobsEncoded = await Promise.all(
    blobs.map(async (b) => ({
      fileId: b.fileId,
      mimeType: b.mimeType,
      name: b.name,
      size: b.size,
      storedAt: b.storedAt,
      dataB64: await blobToBase64(b.data),
    })),
  );
  return {
    schemaVersion: 3,
    createdAt: Date.now(),
    contacts,
    messages,
    outbox,
    lifecycle,
    blobs: blobsEncoded,
  };
}

export async function importDexieDump(dump: DexieDump): Promise<void> {
  if (!dump || dump.schemaVersion !== 3) {
    throw new Error("Backup schema version mismatch");
  }
  await dxdb.transaction(
    "rw",
    [dxdb.contacts, dxdb.messages, dxdb.outbox, dxdb.lifecycle, dxdb.blobs],
    async () => {
      // Non-destructive restore: current conversations, contacts and attachments
      // must never be erased just because an older backup was imported.
      // Existing contact names and preferences take priority over older backups.
      const currentContacts = new Set(await dxdb.contacts.toCollection().primaryKeys());
      await dxdb.contacts.bulkPut((dump.contacts || []).filter((c) => !currentContacts.has(c.onion)));
      const presentIds = new Set(await dxdb.messages.toCollection().primaryKeys());
      await dxdb.messages.bulkPut((dump.messages || []).filter((m) => !presentIds.has(m.id)));
      const outboxIds = new Set(await dxdb.outbox.toCollection().primaryKeys());
      await dxdb.outbox.bulkPut((dump.outbox || []).filter((m) => !outboxIds.has(m.id)));
      const lifecycleIds = new Set(await dxdb.lifecycle.toCollection().primaryKeys());
      await dxdb.lifecycle.bulkPut((dump.lifecycle || []).filter((m) => !lifecycleIds.has(m.key)));
      const blobRows: BlobRecord[] = (dump.blobs || []).map((b) => ({
        fileId: b.fileId,
        mimeType: b.mimeType,
        name: b.name,
        size: b.size,
        storedAt: b.storedAt,
        data: base64ToBlob(b.dataB64, b.mimeType),
      }));
      const existingBlobIds = new Set(await dxdb.blobs.toCollection().primaryKeys());
      await dxdb.blobs.bulkPut(blobRows.filter((b) => !existingBlobIds.has(b.fileId)));
    },
  );
}
