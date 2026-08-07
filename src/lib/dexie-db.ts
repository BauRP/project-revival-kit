// Dexie.js local database — the only persistent store for the Trivo P2P stack.
// Tables:
//   - contacts          : userId → publicKey + lastSeen
//   - pending_messages  : outbound queue waiting for a peer to come online
//   - blobs             : binary payloads keyed by fileId
//   - lifecycle         : per-chat edit/delete/pin mirror

import Dexie, { type Table } from "dexie";

export interface ContactRecord {
  userId: string;
  signingKey: string;
  exchangeKey: string;
  updatedAt: number;
  /** Unix-ms timestamp of last verified online presence (set on ping/pong + close). */
  lastSeen?: number;
  /** v3 hidden-service hostname this contact is reachable at (`<56>.onion`). */
  onionAddress?: string;
}

export type PendingPayloadKind =
  | "text_message"
  | "friend_request"
  | "friend_request_status"
  | "message_status"
  | "message_lifecycle";

export interface PendingMessageRecord {
  id: string;
  targetUserId: string;
  senderUserId: string;
  kind: PendingPayloadKind;
  payload: Record<string, unknown>;
  blobFileId?: string;
  /** Pre-built, pre-signed onion frame (JSON) so retries never re-sign. */
  frame?: string;
  createdAt: number;
  status: "queued" | "in_flight" | "delivered" | "failed";
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
  pending_messages!: Table<PendingMessageRecord, string>;
  blobs!: Table<BlobRecord, string>;
  lifecycle!: Table<LifecycleRecord, string>;

  constructor() {
    super("trivo-p2p");
    this.version(1).stores({
      contacts: "&userId, updatedAt",
      pending_messages: "&id, targetUserId, status, createdAt",
      blobs: "&fileId, storedAt",
      lifecycle: "&key, chatKey, messageId, updatedAt",
    });
    // v2 adds lastSeen index on contacts (additive — no data migration needed).
    this.version(2).stores({
      contacts: "&userId, updatedAt, lastSeen",
      pending_messages: "&id, targetUserId, status, createdAt",
      blobs: "&fileId, storedAt, size",
      lifecycle: "&key, chatKey, messageId, updatedAt",
    });
    // v3 indexes the onion address so peers can be resolved by hostname too.
    this.version(3).stores({
      contacts: "&userId, updatedAt, lastSeen, onionAddress",
      pending_messages: "&id, targetUserId, status, createdAt",
      blobs: "&fileId, storedAt, size",
      lifecycle: "&key, chatKey, messageId, updatedAt",
    });
  }
}

export const dxdb = new TrivoDexie();

// ─── Contact directory ────────────────────────────────────────

export async function saveContactKeys(
  userId: string,
  signingKey: string,
  exchangeKey: string,
): Promise<void> {
  if (!userId || !signingKey || !exchangeKey) return;
  const existing = await dxdb.contacts.get(userId);
  await dxdb.contacts.put({
    userId,
    signingKey,
    exchangeKey,
    updatedAt: Date.now(),
    lastSeen: existing?.lastSeen,
  });
}

export async function getContactKeys(
  userId: string,
): Promise<ContactRecord | undefined> {
  return dxdb.contacts.get(userId);
}

export async function setContactLastSeen(userId: string, ts: number = Date.now()): Promise<void> {
  if (!userId) return;
  const existing = await dxdb.contacts.get(userId);
  if (!existing) {
    await dxdb.contacts.put({
      userId,
      signingKey: "",
      exchangeKey: "",
      updatedAt: Date.now(),
      lastSeen: ts,
    });
    return;
  }
  await dxdb.contacts.put({ ...existing, lastSeen: ts });
}

export async function setContactOnion(userId: string, onionAddress: string): Promise<void> {
  if (!userId || !onionAddress) return;
  const existing = await dxdb.contacts.get(userId);
  await dxdb.contacts.put({
    userId,
    signingKey: existing?.signingKey || "",
    exchangeKey: existing?.exchangeKey || "",
    updatedAt: Date.now(),
    lastSeen: existing?.lastSeen,
    onionAddress,
  });
}

export async function getContactOnion(userId: string): Promise<string | null> {
  const rec = await dxdb.contacts.get(userId);
  return rec?.onionAddress ?? null;
}

/** Reverse lookup: which contact owns this onion hostname. */
export async function getContactByOnion(
  onionAddress: string,
): Promise<ContactRecord | undefined> {
  if (!onionAddress) return undefined;
  return dxdb.contacts.where("onionAddress").equals(onionAddress).first();
}

export async function getAllContacts(): Promise<ContactRecord[]> {
  return dxdb.contacts.toArray();
}

export async function getContactLastSeen(userId: string): Promise<number | null> {
  const rec = await dxdb.contacts.get(userId);
  return rec?.lastSeen ?? null;
}

// ─── Pending queue ────────────────────────────────────────────

export async function enqueuePending(record: Omit<PendingMessageRecord, "createdAt" | "status">): Promise<void> {
  await dxdb.pending_messages.put({
    ...record,
    createdAt: Date.now(),
    status: "queued",
  });
}

export async function getPendingFor(targetUserId: string): Promise<PendingMessageRecord[]> {
  const list = await dxdb.pending_messages
    .where("targetUserId")
    .equals(targetUserId)
    .toArray();
  return list
    .filter((r) => r.status === "queued" || r.status === "in_flight")
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Every frame still awaiting delivery, oldest first, across all peers. */
export async function getAllQueuedPending(): Promise<PendingMessageRecord[]> {
  const list = await dxdb.pending_messages.toArray();
  return list
    .filter((r) => r.status === "queued" || r.status === "in_flight")
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function markPendingDelivered(id: string): Promise<void> {
  await dxdb.pending_messages.delete(id);
}

export async function markPendingFailed(id: string): Promise<void> {
  const rec = await dxdb.pending_messages.get(id);
  if (!rec) return;
  await dxdb.pending_messages.put({ ...rec, status: "failed" });
}

export async function setPendingInFlight(id: string): Promise<void> {
  const rec = await dxdb.pending_messages.get(id);
  if (!rec) return;
  await dxdb.pending_messages.put({ ...rec, status: "in_flight" });
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

export async function getLifecycleMap(chatKey: string): Promise<Record<string, Record<string, unknown>>> {
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

  // Order ascending by storedAt → oldest first.
  const all = await dxdb.blobs.orderBy("storedAt").toArray();
  if (all.length === 0) return 0;
  const halfCount = Math.floor(all.length / 2);
  if (halfCount === 0) return 0;
  const victims = all.slice(0, halfCount).map((b) => b.fileId);
  await dxdb.blobs.bulkDelete(victims);
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
  schemaVersion: 2;
  createdAt: number;
  contacts: ContactRecord[];
  pending_messages: PendingMessageRecord[];
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
  const [contacts, pending_messages, lifecycle, blobs] = await Promise.all([
    dxdb.contacts.toArray(),
    dxdb.pending_messages.toArray(),
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
    schemaVersion: 2,
    createdAt: Date.now(),
    contacts,
    pending_messages,
    lifecycle,
    blobs: blobsEncoded,
  };
}

export async function importDexieDump(dump: DexieDump): Promise<void> {
  if (!dump || dump.schemaVersion !== 2) {
    throw new Error("Backup schema version mismatch");
  }
  await dxdb.transaction(
    "rw",
    [dxdb.contacts, dxdb.pending_messages, dxdb.lifecycle, dxdb.blobs],
    async () => {
      await Promise.all([
        dxdb.contacts.clear(),
        dxdb.pending_messages.clear(),
        dxdb.lifecycle.clear(),
        dxdb.blobs.clear(),
      ]);
      await dxdb.contacts.bulkPut(dump.contacts || []);
      await dxdb.pending_messages.bulkPut(dump.pending_messages || []);
      await dxdb.lifecycle.bulkPut(dump.lifecycle || []);
      const blobRows: BlobRecord[] = (dump.blobs || []).map((b) => ({
        fileId: b.fileId,
        mimeType: b.mimeType,
        name: b.name,
        size: b.size,
        storedAt: b.storedAt,
        data: base64ToBlob(b.dataB64, b.mimeType),
      }));
      await dxdb.blobs.bulkPut(blobRows);
    },
  );
}
