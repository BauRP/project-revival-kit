// ============================================================================
//  Trivo Onion Engine — the ONLY network transport (Tor v3 hidden services).
//  ---------------------------------------------------------------------------
//  * Identity = `.onion` address derived from our Ed25519 key (onion-id.ts);
//    the same key is published by the native tor daemon via ADD_ONION.
//  * Egress: every frame is sealed (E2EE + signature, envelope.ts) before it
//    reaches TorTransport.send — there is no plaintext path.
//  * Outbox: Dexie `outbox` is the single source of truth. A frame is stored
//    sealed with status 'pending', shipped, marked 'sent' when the remote
//    hidden service accepted the bytes, and deleted only when the peer returns
//    a signed DELIVERED_ACK (sent after it committed the payload to its DB).
//  * Inbox: raw sealed frames land in `inbox_raw` first, are decrypted and
//    committed to `messages` in one transaction, and only then removed.
//    recoverInbox() replays leftovers after a crash.
// ============================================================================

import {
  TorTransport,
  isTorNativeAvailable,
  TOR_UNAVAILABLE_STATUS,
  type TorStatus,
} from "./tor-native";
import { getOrCreateIdentity } from "./crypto";
import { sealFrameAsync, openFrameAsync } from "./crypto-async";
import type { SealedFrame } from "./envelope";
import {
  isValidOnion,
  normalizeOnion,
  onionFromPublicKey,
  torServiceKeyFromSigningSecret,
} from "./onion-id";
import {
  dxdb,
  getAllContacts,
  getBlob,
  hasBlob,
  putBlob,
  setContactLastSeen,
  type OutboxKind,
  type OutboxRecord,
  type StoredMessage,
} from "./dexie-db";
import { dbGetStrict, dbPutStrict } from "./storage";
import { isLegacyFriendEvent } from "./inbound-durability";
import { validateIncomingTextMessage } from "./inbound-message";
import { canApplyRemoteLifecycle, acceptsLifecycleTimestamp } from "./lifecycle-auth";

export const ONION_SERVICE_PORT = 8443;
export const POLL_INTERVAL_MS = 5_000;
const BLOB_CHUNK_BYTES = 48 * 1024;
const ONLINE_TTL_MS = 30_000;
const BLOB_REQUEST_TIMEOUT_MS = 120_000;
/** Re-send an un-ACKed frame after this long (exponential up to MAX). */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

// ─── Inner (decrypted) frame model ───────────────────────────

type InnerKind =
  | "dispatch"
  | "ack"
  | "hello"
  | "blob_request"
  | "blob_chunk"
  | "blob_sync_request"
  | "blob_missing";

interface InnerFrame {
  kind: InnerKind;
  id: string;
  body: Record<string, unknown>;
}

export type DeliveryState = "sent" | "delivered";

// ─── State ───────────────────────────────────────────────────

let selfOnion: string | null = null;
let signingSecret: string | null = null;
let torStatus: TorStatus = { ...TOR_UNAVAILABLE_STATUS };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let starting: Promise<string> | null = null;

const incomingDispatchListeners = new Set<(payload: Record<string, unknown>) => void>();
const connectionListeners = new Set<(peer: string, connected: boolean) => void>();
const statusListeners = new Set<(status: TorStatus) => void>();
const deliveryListeners = new Set<(messageId: string, state: DeliveryState) => void>();

const reachability = new Map<string, number>();
interface BlobRequest { peer: string; resolve: (ok: boolean) => void }
const blobRequests = new Map<string, BlobRequest>();
interface PartialReceive {
  fileId: string;
  from: string;
  name: string;
  mimeType: string;
  totalChunks: number;
  received: Map<number, string>;
  updatedAt: number;
}
const partialReceives = new Map<string, PartialReceive>();

function safeEach<T extends (...args: never[]) => void>(set: Set<T>, ...args: Parameters<T>) {
  set.forEach((cb) => {
    try {
      cb(...args);
    } catch (e) {
      console.warn("[onion] listener failed", e);
    }
  });
}

export function onionRegisterIncomingListener(
  cb: (payload: Record<string, unknown>) => void,
): () => void {
  incomingDispatchListeners.add(cb);
  return () => void incomingDispatchListeners.delete(cb);
}
export function onionOnConnectionChange(
  cb: (peer: string, connected: boolean) => void,
): () => void {
  connectionListeners.add(cb);
  return () => void connectionListeners.delete(cb);
}
export function onionOnStatus(cb: (status: TorStatus) => void): () => void {
  statusListeners.add(cb);
  cb(torStatus);
  return () => void statusListeners.delete(cb);
}
export function onionOnDelivery(cb: (messageId: string, state: DeliveryState) => void): () => void {
  deliveryListeners.add(cb);
  return () => void deliveryListeners.delete(cb);
}

function notifyStatus(status: TorStatus): void {
  torStatus = status;
  safeEach(statusListeners, status);
}
function markReachable(peer: string, ok: boolean): void {
  if (ok) {
    reachability.set(peer, Date.now());
    void setContactLastSeen(peer, Date.now());
  }
  safeEach(connectionListeners, peer, ok);
}

// ─── Identity ────────────────────────────────────────────────

/** Load our key and derive our onion address. Works without Tor. */
export async function ensureLocalIdentity(): Promise<string> {
  if (selfOnion && signingSecret) return selfOnion;
  const id = await getOrCreateIdentity();
  signingSecret = id.signing.secretKey;
  selfOnion = onionFromPublicKey(id.signing.publicKey);
  return selfOnion;
}

export function onionSelfAddress(): string | null {
  return selfOnion;
}
export function onionCurrentStatus(): TorStatus {
  return torStatus;
}

// ─── Bootstrap ───────────────────────────────────────────────

/** Start tor with our identity key and begin the poll loop. */
export async function onionInit(): Promise<string> {
  if (starting) return starting;
  starting = (async () => {
    const onion = await ensureLocalIdentity();
    await recoverInbox();
    startPolling();
    if (!isTorNativeAvailable()) {
      notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
      throw new Error("TOR_UNAVAILABLE: native Android runtime required");
    }
    await bindNativeListeners();
    await replayNativeInbound();
    const res = await TorTransport.start({
      label: onion,
      secretKey: torServiceKeyFromSigningSecret(signingSecret as string),
    });
    const published = res.onion ? normalizeOnion(res.onion) : null;
    notifyStatus({
      running: res.running,
      bootstrapped: res.bootstrapped,
      bootstrapPercent: res.bootstrapPercent,
      onion: published,
      socksPort: res.socksPort,
      servicePort: res.servicePort,
      lastError:
        published && published !== onion
          ? "Published onion does not match the local identity key"
          : (res.lastError ?? null),
    });
    void drainOutbox();
    return onion;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

let nativeReplay: Promise<void> | null = null;

/** Native entries are deleted only after JS has persisted/decrypted the frame. */
export function replayNativeInbound(): Promise<void> {
  if (!isTorNativeAvailable()) return Promise.resolve();
  if (nativeReplay) return nativeReplay;
  const work = (async () => {
    // Each batch is small to avoid shipping megabytes across the JS bridge.
    for (let batch = 0; batch < 32; batch++) {
      const { entries } = await TorTransport.pendingInbound();
      if (!entries.length) break;
      for (const entry of entries) {
        await acceptRawFrame(entry.frame);
        await TorTransport.acknowledgeInbound({ id: entry.id });
      }
    }
  })();
  nativeReplay = work;
  void work.finally(() => { if (nativeReplay === work) nativeReplay = null; }).catch(() => undefined);
  return work;
}

async function bindNativeListeners(): Promise<void> {
  if (listenersBound) return;
  listenersBound = true;
  await TorTransport.addListener("onionMessage", () => {
    // Trigger durable replay instead of trusting a transient JS event.
    void replayNativeInbound();
  });
  await TorTransport.addListener("onionStatus", (status) => notifyStatus(status));
}

// ─── Egress ──────────────────────────────────────────────────

async function seal(to: string, inner: InnerFrame): Promise<string> {
  const from = await ensureLocalIdentity();
  const frame = await sealFrameAsync(inner, from, to, signingSecret as string);
  return JSON.stringify(frame);
}

/** Push sealed bytes to the peer's hidden service. True = remote socket accepted. */
async function ship(peer: string, sealed: string, id: string): Promise<boolean> {
  if (!isTorNativeAvailable() || !isValidOnion(peer)) return false;
  try {
    const res = await TorTransport.send({
      id,
      onion: `${peer}:${ONION_SERVICE_PORT}`,
      frame: sealed,
    });
    markReachable(peer, res.delivered);
    return res.delivered;
  } catch (e) {
    console.warn("[onion] send failed", e);
    markReachable(peer, false);
    return false;
  }
}

async function sendEphemeral(
  peer: string,
  kind: InnerKind,
  body: Record<string, unknown>,
): Promise<boolean> {
  const id = `${kind}-${crypto.randomUUID()}`;
  return ship(peer, await seal(peer, { kind, id, body }), id);
}

/**
 * Durable dispatch: seal → persist in Dexie outbox ('pending') → attempt now.
 * Returns true when the remote hidden service accepted the bytes.
 */
// A repeated scheduled item must reuse the exact sealed frame. Guard the
// check-and-insert phase from concurrent callers in the same WebView.
const dispatchInFlight = new Map<string, Promise<boolean>>();
export async function onionSendDispatch(
  peer: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const to = normalizeOnion(peer);
  if (!isValidOnion(to)) throw new Error(`Not a valid .onion address: ${peer}`);
  const id = String(payload.id || crypto.randomUUID());
  if (!id || id.length > 128) throw new Error("Invalid dispatch ID");
  const kind = String(payload.type || "text_message") as OutboxKind;
  const inFlight = dispatchInFlight.get(id);
  if (inFlight) return inFlight;
  const work = (async () => {
    const previous = await dxdb.outbox.get(id);
    if (previous) {
      if (previous.peer !== to || previous.kind !== kind)
        throw new Error("Dispatch ID already belongs to a different destination or event");
      return attemptOutbox(id);
    }
    const sealed = await seal(to, { kind: "dispatch", id, body: { payload: { ...payload, id } } });
    const now = Date.now();
    await dxdb.outbox.add({
      id, peer: to, kind, frame: sealed, status: "pending",
      attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
    });
    return attemptOutbox(id);
  })();
  dispatchInFlight.set(id, work);
  try {
    return await work;
  } finally {
    if (dispatchInFlight.get(id) === work) dispatchInFlight.delete(id);
  }
}

function backoff(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

async function attemptOutbox(id: string): Promise<boolean> {
  const rec = await dxdb.outbox.get(id);
  if (!rec) return false;
  const ok = await ship(rec.peer, rec.frame, rec.id);
  const attempts = rec.attempts + 1;
  // Update only if the ACK has not already removed the record.
  await dxdb.outbox
    .where("id")
    .equals(id)
    .modify({
      status: ok ? "sent" : "failed",
      attempts,
      updatedAt: Date.now(),
      nextAttemptAt: Date.now() + backoff(attempts),
    } satisfies Partial<OutboxRecord>);
  if (ok && rec.kind === "text_message") {
    const msg = await dxdb.messages.get(id);
    if (msg && msg.status === "pending") {
      await dxdb.messages.update(id, { status: "sent" });
      safeEach(deliveryListeners, id, "sent");
    }
  }
  return ok;
}

async function drainOutboxFor(peer: string): Promise<void> {
  const due = await dxdb.outbox.where("peer").equals(peer).sortBy("createdAt");
  for (const rec of due) {
    if (!(await attemptOutbox(rec.id))) return;
  }
}

export async function drainOutbox(): Promise<void> {
  if (!isTorNativeAvailable()) return;
  const due = await dxdb.outbox.where("nextAttemptAt").belowOrEqual(Date.now()).sortBy("createdAt");
  const failedPeers = new Set<string>();
  for (const rec of due) {
    if (failedPeers.has(rec.peer)) continue;
    if (!(await attemptOutbox(rec.id))) failedPeers.add(rec.peer);
  }
}

// ─── Reachability ────────────────────────────────────────────

export async function onionProbe(peer: string): Promise<boolean> {
  if (!isTorNativeAvailable() || !isValidOnion(peer)) return false;
  try {
    const res = await TorTransport.probe({ onion: `${peer}:${ONION_SERVICE_PORT}` });
    markReachable(peer, res.reachable);
    return res.reachable;
  } catch {
    markReachable(peer, false);
    return false;
  }
}

export function onionIsConnectedTo(peer: string): boolean {
  const last = reachability.get(peer);
  return !!last && Date.now() - last < ONLINE_TTL_MS;
}

/** Probe the peer, announce ourselves and flush everything queued for it. */
export async function onionEnsureConnection(peer: string): Promise<boolean> {
  if (!isValidOnion(peer)) return false;
  if (onionIsConnectedTo(peer)) return true;
  const ok = await onionProbe(peer);
  if (ok) {
    await sendEphemeral(peer, "hello", {});
    await drainOutboxFor(peer);
  }
  return ok;
}

// ─── Ingress (transactional) ─────────────────────────────────

async function acceptRawFrame(raw: string): Promise<void> {
  let outer: SealedFrame;
  try {
    outer = JSON.parse(raw) as SealedFrame;
  } catch {
    return;
  }
  if (!outer || typeof outer.sig !== "string") return;
  const id = `${outer.from}:${outer.sig.slice(0, 32)}`;
  await dxdb.inbox_raw.put({ id, raw, receivedAt: Date.now() });
  await processInboxRecord(id, raw);
}

/** Replay every unprocessed inbound frame (crash / power-loss recovery). */
export async function recoverInbox(): Promise<number> {
  await ensureLocalIdentity();
  const rows = await dxdb.inbox_raw.orderBy("receivedAt").toArray();
  for (const row of rows) await processInboxRecord(row.id, row.raw);
  return rows.length;
}

async function processInboxRecord(rawId: string, raw: string): Promise<void> {
  const self = await ensureLocalIdentity();
  let outer: SealedFrame;
  let inner: InnerFrame;
  try {
    outer = JSON.parse(raw) as SealedFrame;
    inner = (await openFrameAsync(outer, self, signingSecret as string)) as InnerFrame;
  } catch (e) {
    console.warn("[onion] rejected inbound frame:", e instanceof Error ? e.message : e);
    await dxdb.inbox_raw.delete(rawId);
    return;
  }
  const from = outer.from;
  markReachable(from, true);

  switch (inner.kind) {
    case "dispatch": {
      const payload: Record<string, unknown> = {
        ...(inner.body.payload as Record<string, unknown>),
        from,
        to: self,
      };
      const committed = await commitDispatch(rawId, payload);
      await sendEphemeral(from, "ack", { ids: [String(payload.id)] }).catch(() => false);
      if (committed) safeEach(incomingDispatchListeners, payload);
      return;
    }
    case "ack": {
      const ids = Array.isArray(inner.body.ids) ? (inner.body.ids as string[]) : [];
      const confirmed: string[] = [];
      await dxdb.transaction("rw", [dxdb.outbox, dxdb.messages, dxdb.inbox_raw], async () => {
        for (const mid of ids) {
          if (typeof mid !== "string") continue;
          const rec = await dxdb.outbox.get(mid);
          // A signed ACK is meaningful only for a frame previously sent to
          // this EXACT peer; forged/foreign message IDs cannot update the UI.
          if (!rec || rec.peer !== from) continue;
          await dxdb.outbox.delete(mid);
          const msg = await dxdb.messages.get(mid);
          if (msg && msg.status !== "read")
            await dxdb.messages.update(mid, { status: "delivered" });
          confirmed.push(mid);
        }
        await dxdb.inbox_raw.delete(rawId);
      });
      confirmed.forEach((mid) => safeEach(deliveryListeners, mid, "delivered"));
      return;
    }
    case "hello":
      await dxdb.inbox_raw.delete(rawId);
      await drainOutboxFor(from);
      return;
    case "blob_request": {
      await dxdb.inbox_raw.delete(rawId);
      const fileId = String(inner.body.fileId || "");
      const have = Array.isArray(inner.body.have) ? (inner.body.have as number[]) : [];
      if (await hasBlob(fileId) && await canPeerRequestBlob(from, fileId)) {
        await sendBlob(from, fileId, (i) => !have.includes(i));
      } else {
        await sendEphemeral(from, "blob_missing", { fileId });
      }
      return;
    }
    case "blob_sync_request": {
      await dxdb.inbox_raw.delete(rawId);
      const missing = Array.isArray(inner.body.missing) ? (inner.body.missing as number[]) : [];
      const requestedFile = String(inner.body.fileId || "");
      if (await canPeerRequestBlob(from, requestedFile)) {
        await sendBlob(from, requestedFile, (i) => missing.includes(i));
      }
      return;
    }
    case "blob_chunk":
      await acceptBlobChunk(from, inner.body);
      await dxdb.inbox_raw.delete(rawId);
      return;
    case "blob_missing": {
      await dxdb.inbox_raw.delete(rawId);
      const fileId = String(inner.body.fileId || "");
      const pending = blobRequests.get(fileId);
      if (pending && pending.peer === from && !partialReceives.has(fileId)) {
        blobRequests.delete(fileId);
        pending.resolve(false);
      }
      return;
    }
    default:
      await dxdb.inbox_raw.delete(rawId);
  }
}

/**
 * Persist a decrypted dispatch payload and drop its raw frame in the same
 * transaction. Returns false for duplicates (already committed earlier).
 */
async function commitDispatch(rawId: string, payload: Record<string, unknown>): Promise<boolean> {
  const type = String(payload.type || "");
  const id = String(payload.id || "");
  let fresh = false;
  await dxdb.transaction("rw", [dxdb.messages, dxdb.inbox_raw, dxdb.lifecycle], async () => {
    if (type === "text_message") {
      const validated = validateIncomingTextMessage(payload);
      if (validated && !(await dxdb.messages.get(id))) {
        await dxdb.messages.add(validated as StoredMessage);
        fresh = true;
      }
    } else if (type === "message_status") {
      const mid = String(payload.messageId || "");
      const msg = await dxdb.messages.get(mid);
      if (msg && msg.from === payload.to && msg.to === payload.from && payload.status === "read") {
        await dxdb.messages.update(mid, { status: "read" });
      }
      fresh = true;
    } else if (type === "message_reaction") {
      const mid = String(payload.messageId || "");
      const original = await dxdb.messages.get(mid);
      const emoji = payload.emoji;
      if (!original ||
          original.from !== payload.from && original.to !== payload.from ||
          original.from !== payload.to && original.to !== payload.to ||
          (emoji !== null && (typeof emoji !== "string" || emoji.length > 24)) ||
          mid.length > 128) {
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      const key = JSON.stringify(["reaction", String(payload.from), mid, String(payload.from)]);
      const incomingAt = Number(payload.updatedAt);
      const timestamp = Number.isFinite(incomingAt) ? Math.min(incomingAt, Date.now() + 60_000) : Date.now();
      const previous = await dxdb.lifecycle.get(key);
      if (!previous || previous.updatedAt <= timestamp) {
        await dxdb.lifecycle.put({
          key,
          chatKey: `reaction::${String(payload.from)}`,
          messageId: mid,
          data: { reactorId: String(payload.from), emoji },
          updatedAt: timestamp,
        });
      }
      fresh = true;
    } else if (type === "profile_update") {
      // Only the authenticated peer's profile may reach the UI listener.
      // The listener checks the contact allowlist before saving it.
      const profile = payload.profile;
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      fresh = true;
    } else if (type === "message_lifecycle") {
      const ck = String(payload.chatKey || "");
      const mid = String(payload.messageId || "");
      if (ck && mid) {
        const original = await dxdb.messages.get(mid);
        const sender = String(payload.from || "");
        const recipient = String(payload.to || "");
        const expectedChatKey = [sender, recipient].sort().join("__");
        const patch = (payload.patch || {}) as Record<string, unknown>;
        if (!canApplyRemoteLifecycle(original, sender, recipient, ck, patch)) {
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
        const key = `${ck}::${mid}`;
        const priorRecord = await dxdb.lifecycle.get(key);
        const prev = priorRecord?.data || { messageId: mid };
        if (!acceptsLifecycleTimestamp(prev.remoteUpdatedAt, payload.updatedAt)) {
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
        const next: Record<string, unknown> = {
          ...prev,
          ...patch,
          messageId: mid,
          updatedAt: payload.updatedAt,
          remoteUpdatedAt: payload.updatedAt,
        };
        if (patch.clearPin) {
          delete next.pinnedAt;
          delete next.pinnedBy;
        }
        await dxdb.lifecycle.put({
          key,
          chatKey: ck,
          messageId: mid,
          data: next,
          updatedAt: Date.now(),
        });
      }
      fresh = true;
    } else {
      fresh = true;
    }
    // Friend requests are persisted in a second IndexedDB database. Keep
    // the sealed frame until that database has fully committed as well.
    if (!isLegacyFriendEvent(type)) await dxdb.inbox_raw.delete(rawId);
  });
  if (type === "friend_request") {
    await dbPutStrict("settings", `friend-req-in-${payload.from}`,
      { ...payload, status: "pending" });
  }
  if (type === "friend_request_status" && payload.status === "accepted") {
    const out = await dbGetStrict<Record<string, unknown>>("settings",
      `friend-req-out-${payload.from}`);
    if (out) await dbPutStrict("settings", `friend-req-out-${payload.from}`,
      { ...out, status: "accepted" });
  }
  // Only acknowledge the remote peer after BOTH databases have committed.
  // If a power loss happens here, recoverInbox safely repeats the idempotent
  // legacy write; the sender will not be ACKed until it is durable.
  if (isLegacyFriendEvent(type)) await dxdb.inbox_raw.delete(rawId);
  return fresh;
}

/** Keep a file private to the chat participants to whom it was sent. */
async function canPeerRequestBlob(peer: string, fileId: string): Promise<boolean> {
  if (!fileId || !isValidOnion(peer)) return false;
  const self = await ensureLocalIdentity();
  const rows = await dxdb.messages.where("to").equals(peer).toArray();
  return rows.some((row) => {
    const media = row.media as { fileId?: string } | undefined;
    return row.from === self && media?.fileId === fileId;
  });
}

// ─── Blob transfer (sealed, chunked, resumable) ──────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sendBlob(peer: string, fileId: string, include: (index: number) => boolean) {
  const rec = await getBlob(fileId);
  if (!rec) return;
  // Stream each slice separately. Never materialize a 1 GB attachment in RAM.
  const totalChunks = Math.max(1, Math.ceil(rec.data.size / BLOB_CHUNK_BYTES));
  for (let index = 0; index < totalChunks; index++) {
    if (!include(index)) continue;
    const slice = new Uint8Array(await rec.data.slice(
      index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES,
    ).arrayBuffer());
    const ok = await sendEphemeral(peer, "blob_chunk", {
      fileId,
      index,
      totalChunks,
      name: rec.name,
      mimeType: rec.mimeType,
      data: bytesToBase64(slice),
    });
    if (!ok) return;
  }
}

async function acceptBlobChunk(from: string, body: Record<string, unknown>): Promise<void> {
  const fileId = String(body.fileId || "");
  const pending = blobRequests.get(fileId);
  // Reject unsolicited frames, unexpected senders and abusive chunk counts.
  const index = Number(body.index);
  const chunks = Number(body.totalChunks);
  const base64 = String(body.data || "");
  if (!fileId || !pending || pending.peer !== from ||
      !Number.isSafeInteger(index) || !Number.isSafeInteger(chunks) ||
      chunks < 1 || chunks > 24000 || index < 0 || index >= chunks ||
      base64.length > 80000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return;
  const prior = partialReceives.get(fileId);
  if (prior && (prior.from !== from || prior.totalChunks !== chunks)) return;
  const entry: PartialReceive = prior || {
    fileId,
    from,
    name: String(body.name || fileId),
    mimeType: String(body.mimeType || "application/octet-stream"),
    totalChunks: Number(body.totalChunks || 1),
    received: new Map<number, string>(),
    updatedAt: Date.now(),
  };
  entry.received.set(index, base64);
  entry.updatedAt = Date.now();
  partialReceives.set(fileId, entry);
  if (entry.received.size < entry.totalChunks) return;
  const ordered: Uint8Array[] = [];
  for (let i = 0; i < entry.totalChunks; i++) {
    const part = entry.received.get(i);
    if (part === undefined) return;
    ordered.push(base64ToBytes(part));
  }
  await putBlob(
    fileId,
    new Blob(ordered as BlobPart[], { type: entry.mimeType }),
    entry.name,
    entry.mimeType,
  );
  partialReceives.delete(fileId);
  const request = blobRequests.get(fileId);
  if (request && request.peer === from) {
    blobRequests.delete(fileId);
    request.resolve(true);
  }
}

/** Only request encrypted media from its authenticated message sender. */
export function onionRequestBlob(fileId: string, peer: string): Promise<boolean> {
  const source = normalizeOnion(peer);
  if (!fileId || !isValidOnion(source)) return Promise.resolve(false);
  const existing = blobRequests.get(fileId);
  if (existing) return Promise.resolve(false); // One active owner per file.
  return new Promise<boolean>((resolve) => {
    const request: BlobRequest = { peer: source, resolve };
    blobRequests.set(fileId, request);
    void (async () => {
      const partial = partialReceives.get(fileId);
      const sent = await sendEphemeral(source, "blob_request", {
        fileId,
        have: partial?.from === source ? Array.from(partial.received.keys()) : [],
      });
      if (!sent && blobRequests.get(fileId) === request) {
        blobRequests.delete(fileId);
        resolve(false);
      }
    })().catch(() => {
      if (blobRequests.get(fileId) === request) {
        blobRequests.delete(fileId);
        resolve(false);
      }
    });
    setTimeout(() => {
      if (blobRequests.get(fileId) === request) {
        blobRequests.delete(fileId);
        partialReceives.delete(fileId);
        resolve(false);
      }
    }, BLOB_REQUEST_TIMEOUT_MS);
  });
}

// ─── Poll loop ───────────────────────────────────────────────

let polling = false;

async function pollTick(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    if (isTorNativeAvailable()) {
      const status = await TorTransport.getStatus().catch(() => torStatus);
      notifyStatus(status);
    }
    await drainOutbox();
    if (isTorNativeAvailable()) await replayNativeInbound();
    for (const entry of partialReceives.values()) {
      if (Date.now() - entry.updatedAt <= POLL_INTERVAL_MS * 2) continue;
      const missing: number[] = [];
      for (let i = 0; i < entry.totalChunks; i++) if (!entry.received.has(i)) missing.push(i);
      if (missing.length)
        await sendEphemeral(entry.from, "blob_sync_request", { fileId: entry.fileId, missing });
    }
    for (const [peer, ts] of reachability) {
      if (Date.now() - ts >= ONLINE_TTL_MS) {
        reachability.delete(peer);
        safeEach(connectionListeners, peer, false);
      }
    }
  } catch (e) {
    console.warn("[onion] poll tick failed", e);
  } finally {
    polling = false;
  }
}

export function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollTick(), POLL_INTERVAL_MS);
  void pollTick();
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function onionShutdownNative(): Promise<void> {
  stopPolling();
  if (isTorNativeAvailable()) await TorTransport.stop().catch(() => undefined);
  notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
}
