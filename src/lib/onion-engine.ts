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
import { type SealedFrame, isPlausibleSealedFrame } from "./envelope";
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
  putReceivedBlob,
  setContactLastSeen,
  type OutboxKind,
  type OutboxRecord,
  type StoredMessage,
} from "./dexie-db";
import { dbGetStrict, dbPutStrict } from "./storage";
import { isLegacyFriendEvent } from "./inbound-durability";
import { validateIncomingTextMessage } from "./inbound-message";
import { chunkDigest, matchesChunkDigest } from "./chunk-integrity";
import { inspectAttachmentBlob } from "./security-scan";
import { orderedCompleteChunkSet } from "./media-chunks";
import { validateSharedProfile } from "./profile-wire";
import { deniedByHistoryProtection } from "./history-protection-policy";
import { validateDispatchBody, boundedAcknowledgements, boundedDispatchString } from "./inbound-frame-policy";
import { boundedChunkIndexes, boundedMediaTransferWindow, validBlobFileId } from "./blob-request-policy";
import { nextMissingChunkPage, initialTransferWindow } from "./media-retry-policy";
import { hasTransferTimedOut } from "./media-timeout-policy";
import { MediaSendGate } from "./media-send-gate";
import { matchesPublishedOnion } from "./onion-publication-policy";
import { mayQueueOriginalText } from "./outbox-delivery-policy";
import { shouldApplyRemoteReaction } from "./reaction-policy";
import { validateIncomingFriendRequest, shouldApplyIncomingFriendRequest } from "./friend-request-policy";
import { deletedMessageKey, isDeletedMessageRecord, LOCAL_DELETED_CHAT_KEY, findUnreferencedMedia, redactLocalMessage, matchesIncomingChunkManifest } from "./message-deletion-policy";
import { duplicateMessageMatches } from "./inbound-identity";
import { consumedMediaKey, isConsumedMediaRecord } from "./one-time-policy";
import { shouldAckDispatch, shouldNotifyDispatch, isValidDispatchId, sameOutgoingDispatchRoute, type DispatchCommitResult } from "./dispatch-commit";
import { canApplyRemoteLifecycle, acceptsLifecycleTimestamp, canMutateDeletedMessage, isDuplicateRemoteDeletion } from "./lifecycle-auth";

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
  | "blob_missing"
  | "cover";

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
interface BlobRequest {
  peer: string;
  resolve: (ok: boolean) => void;
  lastProgressAt: number;
}
const blobRequests = new Map<string, BlobRequest>();
interface PartialReceive {
  fileId: string;
  from: string;
  name: string;
  mimeType: string;
  totalChunks: number;
  received: Set<number>;
  updatedAt: number;
  retryCursor?: number;
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
  if (!isValidOnion(peer)) return;
  const wasOnline = onionIsConnectedTo(peer);
  if (ok) {
    const now = Date.now();
    // Keep memory bounded even if a malicious sender cycles thousands of
    // signed .onion identities. Expire old reachability before eviction.
    for (const [id, last] of reachability)
      if (now - last >= ONLINE_TTL_MS) reachability.delete(id);
    if (!reachability.has(peer) && reachability.size >= 1024) {
      const oldest = reachability.keys().next().value;
      if (oldest) reachability.delete(oldest);
    }
    reachability.delete(peer); // refresh recency for bounded oldest-first eviction
    reachability.set(peer, now);
    void setContactLastSeen(peer, now).catch((error) =>
      console.warn("[onion] unable to update optional last-seen metadata", error));
  } else {
    reachability.delete(peer);
  }
  // A repeated successful probe is not a new connection. Avoid triggering
  // reconnect sync storms for profiles, history protection, etc.
  if (wasOnline !== ok) safeEach(connectionListeners, peer, ok);
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
    const res = await TorTransport.start({
      label: onion,
      secretKey: torServiceKeyFromSigningSecret(signingSecret as string),
    });
    const published = res.onion ? normalizeOnion(res.onion) : null;
    // A running Tor daemon is not evidence that our own service has the
    // identity shown to contacts. Refuse to operate under a different onion.
    if (!matchesPublishedOnion(onion, published)) {
      await TorTransport.stop().catch((error) =>
        console.error("[onion] unable to stop mismatched onion service", error));
      notifyStatus({
        ...TOR_UNAVAILABLE_STATUS,
        lastError: "Published onion does not match the local identity key",
      });
      throw new Error("TOR_IDENTITY_MISMATCH: published hidden service key differs from local identity");
    }
    notifyStatus({
      running: res.running,
      bootstrapped: res.bootstrapped,
      bootstrapPercent: res.bootstrapPercent,
      onion: published,
      socksPort: res.socksPort,
      servicePort: res.servicePort,
      lastError: res.lastError ?? null,
    });
    // Replay after the hidden service starts, so deferred application ACKs
    // have a usable route. Do not delay opening the app on a large backlog.
    void replayNativeInbound().catch((error) =>
      console.warn("[onion] native inbox replay failed", error));
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
let nativeReplayOffset = 0;

/**
 * Native frames may have arrived while the WebView was stopped. The service
 * already durably committed their sealed bytes before its transport ACK.
 * Deleting a native entry is only safe AFTER acceptRawFrame has completed.
 */
export function replayNativeInbound(): Promise<void> {
  if (!isTorNativeAvailable()) return Promise.resolve();
  if (nativeReplay) return nativeReplay;
  const work = (async () => {
    // Bounded per invocation, giving rendering and other work opportunities.
    // pollTick and the native event listener will continue replay as needed.
    for (let batch = 0; batch < 32; batch++) {
      const { entries } = await TorTransport.pendingInbound({ offset: nativeReplayOffset });
      if (entries.length === 0) {
        nativeReplayOffset = 0;
        break;
      }
      let progressed = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          await acceptRawFrame(entry.frame);
          await TorTransport.acknowledgeInbound({ id: entry.id });
          progressed++;
        } catch (error) {
          // One temporarily unprocessable frame must not prevent the other
          // entries in the batch from committing to Dexie.
          failed++;
          console.warn("[onion] retaining uncommitted native frame", error);
        }
      }
      // Entries successfully acknowledged disappear and shift the queue
      // towards the front. Only failed entries remain before the cursor.
      // A persistent poison frame cannot block messages behind it.
      nativeReplayOffset += failed;
      if (entries.length < 8 || nativeReplayOffset >= 4096) {
        nativeReplayOffset = 0;
        break;
      }
      // No progress: avoid hammering the failing records. The next poll
      // resumes after them, so other senders' messages still get through.
      if (progressed === 0) break;
    }
  })();
  nativeReplay = work;
  void work.finally(() => { if (nativeReplay === work) nativeReplay = null; }).catch(() => undefined);
  return work;
}

async function bindNativeListeners(): Promise<void> {
  if (listenersBound) return;
  // Registration is a two-step native operation. If either listener fails,
  // remove any partial registration and allow the next startup to retry.
  const message = await TorTransport.addListener("onionMessage", () => {
    void replayNativeInbound().catch((error) =>
      console.warn("[onion] native notification replay failed", error));
  });
  try {
    await TorTransport.addListener("onionStatus", (status) => notifyStatus(status));
    listenersBound = true;
  } catch (error) {
    await message.remove().catch(() => undefined);
    throw error;
  }
}

// ─── Egress ──────────────────────────────────────────────────

/**
 * Experimental *real* encrypted Tor cover frame, opt-in only.
 * This can add uncertainty to simple traffic timing observations, but does
 * NOT provide Vuvuzela/Alpenhorn anonymity, constant-rate mixing, or
 * protection against a global network observer. No backend is required.
 */
export async function onionSendCoverFrame(): Promise<boolean> {
  if (!isTorNativeAvailable() || !torStatus.running || !torStatus.bootstrapped)
    return false;
  const peers = (await getAllContacts()).map((c) => c.onion)
    .filter((peer) => isValidOnion(peer) && onionIsConnectedTo(peer));
  if (!peers.length) return false;
  const chooser = crypto.getRandomValues(new Uint32Array(1))[0] % peers.length;
  const peer = peers[chooser];
  const bytes = crypto.getRandomValues(new Uint8Array(96));
  return sendEphemeral(peer, "cover", { padding: bytesToBase64(bytes) });
}


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
const dispatchInFlight = new Map<string, {
  peer: string; kind: string; promise: Promise<boolean>;
}>();
export async function onionSendDispatch(
  peer: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const to = normalizeOnion(peer);
  if (!isValidOnion(to)) throw new Error(`Not a valid .onion address: ${peer}`);
  const id = payload.id === undefined ? crypto.randomUUID() : payload.id;
  if (!isValidDispatchId(id)) throw new Error("Invalid dispatch ID");
  const kind = payload.type === undefined ? "text_message" : payload.type;
  if (typeof kind !== "string" || !kind || kind.length > 64)
    throw new Error("Invalid outgoing dispatch type");
  const inFlight = dispatchInFlight.get(id);
  if (inFlight) {
    if (!sameOutgoingDispatchRoute(inFlight, { peer: to, kind }))
      throw new Error("Dispatch ID already belongs to a different destination or event");
    return inFlight.promise;
  }
  const work = (async () => {
    const previous = await dxdb.outbox.get(id);
    if (previous) {
      if (previous.peer !== to || previous.kind !== kind)
        throw new Error("Dispatch ID already belongs to a different destination or event");
      return attemptOutbox(id);
    }
    const sealed = await seal(to, { kind: "dispatch", id, body: { payload: { ...payload, id } } });
    const now = Date.now();
    // Sealing is asynchronous. A user may delete the original message while
    // this frame is being encrypted; atomically check its tombstone BEFORE
    // the sealed frame can enter the outbound queue.
    await dxdb.transaction("rw", [dxdb.outbox, dxdb.lifecycle], async () => {
      if (kind === "text_message" &&
          !mayQueueOriginalText((await dxdb.lifecycle.get(deletedMessageKey(id)))?.data))
        throw new Error("Original message was deleted before it could be queued");
      const concurrent = await dxdb.outbox.get(id);
      if (concurrent) {
        if (concurrent.peer !== to || concurrent.kind !== kind)
          throw new Error("Dispatch ID already belongs to a different destination or event");
        return;
      }
      await dxdb.outbox.add({
        id, peer: to, kind: kind as OutboxKind, frame: sealed, status: "pending",
        attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
      });
    });
    return attemptOutbox(id);
  })();
  dispatchInFlight.set(id, { peer: to, kind, promise: work });
  try {
    return await work;
  } finally {
    if (dispatchInFlight.get(id)?.promise === work) dispatchInFlight.delete(id);
  }
}

function backoff(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

// The poller, a fresh dispatch and peer reconnect can all attempt the same
// frame at once. Serialize shipping per ID to prevent duplicate network sends.
const outboxFlights = new Map<string, Promise<boolean>>();
async function attemptOutbox(id: string): Promise<boolean> {
  const existing = outboxFlights.get(id);
  if (existing) return existing;
  const work = sendOutboxOnce(id);
  outboxFlights.set(id, work);
  try { return await work; } finally {
    if (outboxFlights.get(id) === work) outboxFlights.delete(id);
  }
}
async function sendOutboxOnce(id: string): Promise<boolean> {
  const rec = await dxdb.transaction("r", [dxdb.outbox, dxdb.lifecycle], async () => {
    const queued = await dxdb.outbox.get(id);
    if (!queued) return undefined;
    if (queued.kind === "text_message" &&
        !mayQueueOriginalText((await dxdb.lifecycle.get(deletedMessageKey(id)))?.data))
      return undefined;
    return queued;
  });
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
  if (!isPlausibleSealedFrame(outer)) return;
  // Persist with full signature to prevent truncated-ID collisions.
  const id = `${outer.from}:${outer.sig}`;
  await dxdb.inbox_raw.put({ id, raw, receivedAt: Date.now() });
  await processInboxRecord(id, raw);
}

/** Replay every unprocessed inbound frame (crash / power-loss recovery). */
export async function recoverInbox(): Promise<number> {
  await ensureLocalIdentity();
  const rows = await dxdb.inbox_raw.orderBy("receivedAt").toArray();
  for (const row of rows) {
    try { await processInboxRecord(row.id, row.raw); }
    catch (error) { console.warn("[onion] retaining failed inbox row for retry", error); }
  }
  return rows.length;
}

async function processInboxRecord(rawId: string, raw: string): Promise<void> {
  const self = await ensureLocalIdentity();
  let outer: SealedFrame;
  let inner: InnerFrame;
  try {
    outer = JSON.parse(raw) as SealedFrame;
    const opened = await openFrameAsync(outer, self, signingSecret as string);
    if (!opened || typeof opened !== "object" || Array.isArray(opened))
      throw new Error("Invalid decrypted frame");
    inner = opened as InnerFrame;
    if (typeof inner.kind !== "string" || !inner.body ||
        typeof inner.body !== "object" || Array.isArray(inner.body))
      throw new Error("Invalid decrypted frame body");
  } catch (e) {
    console.warn("[onion] rejected inbound frame:", e instanceof Error ? e.message : e);
    await dxdb.inbox_raw.delete(rawId);
    return;
  }
  const from = outer.from;
  markReachable(from, true);

  switch (inner.kind) {
    case "dispatch": {
      const body = validateDispatchBody(inner.body.payload);
      if (!body) {
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      const payload: Record<string, unknown> = { ...body, from, to: self };
      const result = await commitDispatch(rawId, payload);
      if (shouldAckDispatch(result))
        await sendEphemeral(from, "ack", { ids: [String(payload.id)] }).catch(() => false);
      if (shouldNotifyDispatch(result)) safeEach(incomingDispatchListeners, payload);
      return;
    }
    case "ack": {
      const ids = boundedAcknowledgements(inner.body.ids);
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
    case "cover":
      // A valid, signed dummy frame; it is never a chat message and never
      // persisted outside the transient sealed inbox.
      await dxdb.inbox_raw.delete(rawId);
      return;
    case "blob_request": {
      await dxdb.inbox_raw.delete(rawId);
      const fileId = inner.body.fileId;
      const have = boundedChunkIndexes(inner.body.have);
      if (!validBlobFileId(fileId) || !have) return;
      const hasWindow = inner.body.windowStart !== undefined ||
        inner.body.windowCount !== undefined;
      const available = await getBlob(fileId);
      if (!available || !(await canPeerRequestBlob(from, fileId))) {
        await sendEphemeral(from, "blob_missing", { fileId });
        return;
      }
      const window = hasWindow
        ? boundedMediaTransferWindow(inner.body.windowStart, inner.body.windowCount,
          Math.max(1, Math.ceil(available.data.size / BLOB_CHUNK_BYTES)))
        : null;
      if (hasWindow && !window) return;
      {
        // A 1 GB attachment may take hours. Never block the signed inbound
        // inbox and other chats while sending its individual Tor chunks.
        mediaSendGate.start(from, fileId, () =>
          sendBlob(from, fileId, (i) => !have.has(i) &&
            (!window || (i >= window.start && i < window.start + window.count))));
      }
      return;
    }
    case "blob_sync_request": {
      await dxdb.inbox_raw.delete(rawId);
      const missing = boundedChunkIndexes(inner.body.missing);
      if (!missing) return;
      const requestedFile = inner.body.fileId;
      if (!validBlobFileId(requestedFile)) return;
      if (await hasBlob(requestedFile) && await canPeerRequestBlob(from, requestedFile)) {
        mediaSendGate.start(from, requestedFile, () =>
          sendBlob(from, requestedFile, (i) => missing.has(i)));
      }
      return;
    }
    case "blob_chunk":
      // Chunks are transient until their parent blob is assembled. Keep the
      // sealed frame on disk if processing fails; replay can retry safely.
      await acceptBlobChunk(from, inner.body);
      await dxdb.inbox_raw.delete(rawId);
      return;
    case "blob_missing": {
      await dxdb.inbox_raw.delete(rawId);
      const fileId = inner.body.fileId;
      if (!validBlobFileId(fileId)) return;
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
async function commitDispatch(rawId: string, payload: Record<string, unknown>): Promise<DispatchCommitResult> {
  const type = String(payload.type || "");
  const id = String(payload.id || "");
  let fresh = false;
  let rejected = false;
  if (!isValidDispatchId(payload.id)) {
    await dxdb.inbox_raw.delete(rawId);
    return "rejected";
  }
  await dxdb.transaction("rw", [
    dxdb.messages, dxdb.inbox_raw, dxdb.lifecycle, dxdb.contacts,
    dxdb.blobs, dxdb.partial_chunks,
  ], async () => {
    if (type === "text_message") {
      const validated = validateIncomingTextMessage(payload);
      if (!validated) rejected = true;
      if (validated) {
        const erased = await dxdb.lifecycle.get(deletedMessageKey(id));
        if (isDeletedMessageRecord(erased?.data)) {
          // Locally deleted messages remain deleted even after sender retry.
          // Acknowledge this as a handled duplicate, without notifying the UI.
        } else {
          const existing = await dxdb.messages.get(id);
          if (!existing) {
            await dxdb.messages.add(validated as StoredMessage);
            fresh = true;
          } else if (!duplicateMessageMatches(existing, validated)) {
          // A collision from another sender is NOT a successful duplicate.
            rejected = true;
          }
        }
      }
    } else if (type === "message_status") {
      const mid = boundedDispatchString(payload.messageId) ?? "";
      const msg = await dxdb.messages.get(mid);
      if (msg && msg.from === payload.to && msg.to === payload.from && payload.status === "read") {
        if (msg.status !== "read") {
          await dxdb.messages.update(mid, { status: "read" });
          fresh = true;
        }
      } else {
        rejected = true;
      }
    } else if (type === "message_reaction") {
      const mid = boundedDispatchString(payload.messageId) ?? "";
      const original = await dxdb.messages.get(mid);
      const emoji = payload.emoji;
      if (!original ||
          original.from !== payload.from && original.to !== payload.from ||
          original.from !== payload.to && original.to !== payload.to ||
          (emoji !== null && (typeof emoji !== "string" || emoji.length > 24)) ||
          mid.length > 128) {
        rejected = true;
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      const key = JSON.stringify(["reaction", String(payload.from), mid, String(payload.from)]);
      const incomingAt = typeof payload.updatedAt === "number" ? payload.updatedAt : NaN;
      if (!Number.isSafeInteger(incomingAt) || incomingAt <= 0 || incomingAt > Date.now() + 60_000) {
        rejected = true;
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      const timestamp = incomingAt;
      const previous = await dxdb.lifecycle.get(key);
      if (shouldApplyRemoteReaction(previous?.updatedAt, timestamp)) {
        await dxdb.lifecycle.put({
          key,
          chatKey: `reaction::${String(payload.from)}`,
          messageId: mid,
          data: { reactorId: String(payload.from), emoji },
          updatedAt: timestamp,
        });
        fresh = true;
      }
    } else if (type === "profile_update") {
      // Validate and persist before ACK. Only an existing contact may update
      // their own profile; the authenticated frame sender is authoritative.
      const sender = String(payload.from || "");
      const profile = validateSharedProfile(payload.profile, sender);
      const contact = profile ? await dxdb.contacts.get(sender) : undefined;
      if (!profile || !contact) {
        rejected = true;
        await dxdb.inbox_raw.delete(rawId);
        return;
      }
      const key = `profile::${sender}`;
      const previous = await dxdb.lifecycle.get(key);
      if (!previous || Number(previous.data.updatedAt || 0) < profile.updatedAt) {
        await dxdb.lifecycle.put({
          key, chatKey: "remote-profile", messageId: sender,
          data: { ...profile }, updatedAt: profile.updatedAt,
        });
        fresh = true;
      }
    } else if (type === "history_protection") {
      const enabled = payload.enabled;
      const time = payload.updatedAt;
      const from = String(payload.from || "");
      if (typeof enabled !== "boolean" || typeof time !== "number" ||
          !Number.isSafeInteger(time) || time <= 0 || time > Date.now() + 600_000 ||
          !(await dxdb.contacts.get(from))) {
        rejected = true;
      } else {
        const key = `history-protection::remote::${from}`;
        const previous = await dxdb.lifecycle.get(key);
        if (!previous || Number(previous.data.updatedAt || 0) < time) {
          await dxdb.lifecycle.put({ key, chatKey: "history-protection-remote",
            messageId: from, data: { enabled, updatedAt: time }, updatedAt: time });
          fresh = true;
        }
      }
    } else if (type === "message_lifecycle") {
      const ck = boundedDispatchString(payload.chatKey, 256) ?? "";
      const mid = boundedDispatchString(payload.messageId) ?? "";
      if (ck && mid) {
        const original = await dxdb.messages.get(mid);
        const sender = String(payload.from || "");
        const recipient = String(payload.to || "");
        const expectedChatKey = [sender, recipient].sort().join("__");
        // An authenticated sender may still send null, arrays or primitives.
        // "in" checks inside history protection must never throw on them,
        // leaving a hostile frame stuck in the durable inbox.
        const patchInput = payload.patch;
        if (!patchInput || typeof patchInput !== "object" || Array.isArray(patchInput)) {
          rejected = true;
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
        const patch = patchInput as Record<string, unknown>;
        const protectedRecord = await dxdb.lifecycle.get(`history-protection::local::${sender}`);
        if (deniedByHistoryProtection(protectedRecord?.data.enabled === true, patch)) {
          rejected = true;
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
        if (!canApplyRemoteLifecycle(original, sender, recipient, ck, patch)) {
          rejected = true;
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
        const key = `${ck}::${mid}`;
        const priorRecord = await dxdb.lifecycle.get(key);
        const prev = priorRecord?.data || { messageId: mid };
        if (!canMutateDeletedMessage(prev, patch)) {
          // A retry of the same authenticated deletion must receive an ACK.
          // Otherwise the sender's durable outbox will retry it forever.
          // A later edit/pin is still rejected without modifying the tombstone.
          if (!isDuplicateRemoteDeletion(prev, patch)) rejected = true;
          await dxdb.inbox_raw.delete(rawId);
          return;
        }
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
        if (patch.deletedForEveryone === true) {
          // A verified deletion should not merely hide text in React while
          // retaining recoverable plaintext and media in IndexedDB.
          const originalStored = await dxdb.messages.get(mid);
          if (originalStored) {
            const remaining = await dxdb.messages.filter((row) => row.id !== mid).toArray();
            const orphaned = findUnreferencedMedia(
              [{ media: originalStored.media }],
              remaining.map((row) => ({ media: row.media })),
            );
            await dxdb.messages.put(redactLocalMessage(originalStored));
            if (orphaned.length) {
              await dxdb.blobs.bulkDelete(orphaned);
              await dxdb.partial_chunks.where("fileId").anyOf(orphaned).delete();
            }
          }
          // Prevent late retries and old backups from recreating the deleted
          // message body even when a visible tombstone shell is retained.
          const now = Date.now();
          await dxdb.lifecycle.put({
            key: deletedMessageKey(mid),
            chatKey: LOCAL_DELETED_CHAT_KEY, messageId: mid,
            data: { deleted: true, deletedAt: now }, updatedAt: now,
          });
          delete next.editedText;
          next.isEdited = false;
        }
        await dxdb.lifecycle.put({
          key,
          chatKey: ck,
          messageId: mid,
          data: next,
          updatedAt: Date.now(),
        });
      } else {
        // An incomplete lifecycle command is not a valid delivered event.
        rejected = true;
      }
      if (!rejected) fresh = true;
    } else if (type === "friend_request" || type === "friend_request_status") {
      // These two legacy events are committed to their separate database below.
      fresh = true;
    } else {
      // Unknown events must not be surfaced as successfully handled features.
      rejected = true;
      fresh = false;
    }
    // Friend requests are persisted in a second IndexedDB database. Keep
    // the sealed frame until that database has fully committed as well.
    if (!isLegacyFriendEvent(type)) await dxdb.inbox_raw.delete(rawId);
  });
  if (type === "friend_request") {
    const request = validateIncomingFriendRequest(payload);
    if (!request) {
      await dxdb.inbox_raw.delete(rawId);
      return "rejected";
    }
    const key = `friend-req-in-${request.from}`;
    const previous = await dbGetStrict<{status?: string; timestamp?: number}>("settings", key);
    if (shouldApplyIncomingFriendRequest(previous, request.timestamp))
      await dbPutStrict("settings", key, request);
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
  return rejected ? "rejected" : fresh ? "committed" : "duplicate";
}

/** Keep a file private to the chat participants to whom it was sent. */
async function canPeerRequestBlob(peer: string, fileId: string): Promise<boolean> {
  if (!fileId || !isValidOnion(peer)) return false;
  const self = await ensureLocalIdentity();
  // Send-time permission is rechecked for every chunk. Use an IndexedDB
  // cursor and stop at the first matching message, rather than allocating
  // the peer's entire chat history for every 48 KB of a large file.
  const match = await dxdb.messages.where("to").equals(peer)
    .filter((row) => {
      const media = row.media as { fileId?: string } | undefined;
      return row.from === self && media?.fileId === fileId;
    }).first();
  return !!match;
}

// ─── Blob transfer (sealed, chunked, resumable) ──────────────

// Keep bulk media sending away from the inbound transaction/replay path.
// Concurrent requests for one transfer are coalesced; receivers can retry
// missing pieces. A hard global limit prevents peer-controlled send storms.
const mediaSendGate = new MediaSendGate(4, (error) =>
  console.warn("[onion] background media transfer failed", error));

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
    // A chat deletion or one-time revocation must stop an already-running
    // bulk send; do not hold the old Blob as perpetual access permission.
    if (!(await hasBlob(fileId)) || !(await canPeerRequestBlob(peer, fileId))) return;
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
      digest: chunkDigest(slice),
    });
    if (!ok) return;
  }
}

async function acceptBlobChunk(from: string, body: Record<string, unknown>): Promise<void> {
  const fileId = body.fileId;
  if (!validBlobFileId(fileId)) return;
  const pending = blobRequests.get(fileId);
  // A consumed one-time attachment may not be re-created by a late Tor frame.
  if (fileId && isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data)) return;
  // Reject unsolicited frames, unexpected senders and abusive chunk counts.
  const index = body.index;
  const chunks = body.totalChunks;
  const base64 = body.data;
  if (!pending || pending.peer !== from ||
      typeof index !== "number" || typeof chunks !== "number" ||
      typeof base64 !== "string" ||
      !Number.isSafeInteger(index) || !Number.isSafeInteger(chunks) ||
      chunks < 1 || chunks > Math.ceil((1024 * 1024 * 1024) / BLOB_CHUNK_BYTES) ||
      index < 0 || index >= chunks ||
      base64.length > 80000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return;
  if (typeof body.name !== "string" || !body.name || body.name.length > 255 ||
      typeof body.mimeType !== "string" || !body.mimeType || body.mimeType.length > 128) return;
  const prior = partialReceives.get(fileId);
  if (prior && (prior.from !== from || prior.totalChunks !== chunks ||
      prior.name !== body.name || prior.mimeType !== body.mimeType)) return;
  if (!prior) {
    // A signed chunk is still untrusted. Don't allocate durable storage for
    // a spoofed manifest, or a media ID whose parent message is missing.
    // Query with an IndexedDB cursor to avoid loading the full conversation.
    const recipient = await ensureLocalIdentity();
    const expected = await dxdb.messages.where("from").equals(from)
      .filter((msg) => matchesIncomingChunkManifest(
        msg, from, recipient, fileId, body.name as string,
        body.mimeType as string, chunks, BLOB_CHUNK_BYTES,
      )).first();
    if (!expected) return;
  }
  const entry: PartialReceive = prior || {
    fileId,
    from,
    name: body.name,
    mimeType: body.mimeType,
    totalChunks: chunks,
    received: new Set<number>(),
    updatedAt: Date.now(),
  };
  // Verify a decoded chunk before accepting it into the assembly buffer.
  // Legacy senders without an integrity field must update before transfer.
  let chunkBytes: Uint8Array;
  try { chunkBytes = base64ToBytes(base64); } catch { return; }
  if (chunkBytes.length > BLOB_CHUNK_BYTES ||
      (index !== chunks - 1 && chunkBytes.length !== BLOB_CHUNK_BYTES) ||
      !matchesChunkDigest(chunkBytes, body.digest)) return;
  // Keep only received indexes in RAM. The verified bytes live in Dexie,
  // avoiding gigabytes of base64 strings for large attachments.
  const key = JSON.stringify([fileId, from, index]);
  const diskChunk = await dxdb.partial_chunks.get(key);
  if (diskChunk && (diskChunk.from !== from ||
      diskChunk.name !== entry.name || diskChunk.mimeType !== entry.mimeType ||
      diskChunk.totalChunks !== chunks)) return;
  // Repair an interrupted or corrupted disk write with a freshly verified
  // chunk while refusing attempts to overwrite a valid chunk with new data.
  const storedValid = diskChunk
    ? matchesChunkDigest(new Uint8Array(await diskChunk.data.arrayBuffer()), diskChunk.digest)
    : false;
  if (diskChunk && storedValid && diskChunk.digest !== body.digest) return;
  if (!storedValid) await dxdb.partial_chunks.put({
    key, fileId, from, index, totalChunks: chunks,
    name: entry.name, mimeType: entry.mimeType, digest: String(body.digest),
    data: new Blob([chunkBytes as BlobPart]), updatedAt: Date.now(),
  });
  entry.received.add(index);
  entry.updatedAt = Date.now();
  // A large Tor transfer can legitimately take longer than two minutes.
  // Only an actual newly verified chunk extends the inactivity deadline;
  // duplicate retransmissions cannot keep a stalled download alive forever.
  if (!storedValid) pending.lastProgressAt = performance.now();
  partialReceives.set(fileId, entry);
  if (entry.received.size < entry.totalChunks) return;
  const assembled = await assemblePersistedBlob(fileId, from);
  if (assembled === "incomplete") return;
  partialReceives.delete(fileId);
  const request = blobRequests.get(fileId);
  if (request && request.peer === from) {
    blobRequests.delete(fileId);
    request.resolve(assembled === "saved");
  }
}

/** Assemble only validated persisted parts, without keeping another whole-file
 * copy in JavaScript memory. Safe to run again after a crash.
 */
type AssemblyOutcome = "saved" | "incomplete" | "rejected";
async function assemblePersistedBlob(fileId: string, from: string): Promise<AssemblyOutcome> {
  const records = await dxdb.partial_chunks.where("fileId").equals(fileId).toArray();
  const ordered = orderedCompleteChunkSet(
    records.map((row) => ({ ...row, size: row.data.size })), fileId, from,
  );
  if (!ordered) return "incomplete";
  const parts: BlobPart[] = [];
  for (const row of ordered) {
    const bytes = new Uint8Array(await row.data.arrayBuffer());
    if (!matchesChunkDigest(bytes, row.digest)) return "incomplete";
    parts.push(row.data);
  }
  const first = ordered[0];
  // Recheck after digest verification: revocation can race a large assembly.
  if (isConsumedMediaRecord((await dxdb.lifecycle.get(consumedMediaKey(fileId)))?.data))
    return "rejected";
  const assembled = new Blob(parts, { type: first.mimeType });
  // Hashes verify transport integrity, NOT whether the file is safe.
  // Apply the same offline signature policy to completed incoming files as
  // to outgoing uploads before storing them as downloadable media.
  const inspected = await inspectAttachmentBlob(first.name, first.mimeType, assembled);
  const saved = inspected.safe && await putReceivedBlob(
    fileId, assembled, first.name, first.mimeType, from, await ensureLocalIdentity(),
  );
  // A completed but rejected transfer must not occupy storage forever.
  await dxdb.partial_chunks.where("fileId").equals(fileId).delete();
  return saved ? "saved" : "rejected";
}

/** Only request encrypted media from its authenticated message sender. */
export function onionRequestBlob(fileId: string, peer: string): Promise<boolean> {
  const source = normalizeOnion(peer);
  if (!validBlobFileId(fileId) || !isValidOnion(source)) return Promise.resolve(false);
  const existing = blobRequests.get(fileId);
  if (existing) return Promise.resolve(false); // One active owner per file.
  return new Promise<boolean>((resolve) => {
    const request: BlobRequest = { peer: source, resolve, lastProgressAt: performance.now() };
    blobRequests.set(fileId, request);
    void (async () => {
      // Rehydrate verified chunks after app restart; only ask for missing data.
      let partial = partialReceives.get(fileId);
      if (!partial) {
        const saved = await dxdb.partial_chunks.where("fileId").equals(fileId).toArray();
        const ordered = saved.filter((row) => row.from === source)
          .sort((a, b) => a.index - b.index);
        if (ordered.length) {
          const first = ordered[0];
          const same = ordered.filter((row) =>
            row.totalChunks === first.totalChunks && row.name === first.name &&
            row.mimeType === first.mimeType &&
            Number.isSafeInteger(row.index) && row.index >= 0 && row.index < first.totalChunks &&
            row.data.size <= BLOB_CHUNK_BYTES &&
            (row.index === first.totalChunks - 1 || row.data.size === BLOB_CHUNK_BYTES));
          const received = new Set<number>();
          for (const row of same) {
            const bytes = new Uint8Array(await row.data.arrayBuffer());
            if (matchesChunkDigest(bytes, row.digest)) received.add(row.index);
          }
          partial = { fileId, from: source, name: first.name,
            mimeType: first.mimeType, totalChunks: first.totalChunks,
            received, updatedAt: Date.now() };
          partialReceives.set(fileId, partial);
        }
      }
      if (partial && partial.received.size === partial.totalChunks) {
        const assembled = await assemblePersistedBlob(fileId, source);
        if (assembled !== "incomplete") {
          partialReceives.delete(fileId);
          blobRequests.delete(fileId);
          resolve(assembled === "saved");
          return;
        }
      }
      const firstWindow = initialTransferWindow(
        partial?.from === source ? partial.totalChunks : null,
        partial?.from === source ? partial.received : new Set<number>(),
      );
      const sent = await sendEphemeral(source, "blob_request", {
        fileId,
        // Resume at the first missing piece. Both the advertised window and
        // the legacy "have" array stay small even for a gigabyte file.
        ...firstWindow,
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
    // A fixed two-minute deadline terminated healthy multi-minute file
    // downloads. Check inactivity instead, retaining verified chunks for
    // later resumable retries when the peer actually stops transferring.
    const checkIdle = () => {
      if (blobRequests.get(fileId) !== request) return;
      if (hasTransferTimedOut(request.lastProgressAt, performance.now(), BLOB_REQUEST_TIMEOUT_MS)) {
        blobRequests.delete(fileId);
        partialReceives.delete(fileId);
        resolve(false);
        return;
      }
      setTimeout(checkIdle, Math.min(30_000,
        Math.max(1, request.lastProgressAt + BLOB_REQUEST_TIMEOUT_MS - performance.now())));
    };
    setTimeout(checkIdle, Math.min(30_000, BLOB_REQUEST_TIMEOUT_MS));
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
      // Request at most 128 pieces at a time. Rotate the cursor to avoid
      // repeatedly asking for the first pieces of a multi-gigabyte transfer.
      const page = nextMissingChunkPage(
        entry.totalChunks, entry.received, entry.retryCursor ?? 0,
      );
      if (page.missing.length) {
        entry.retryCursor = page.nextCursor;
        // Throttle retries even when offline or a peer is unreachable.
        entry.updatedAt = Date.now();
        await sendEphemeral(entry.from, "blob_sync_request", {
          fileId: entry.fileId, missing: page.missing,
        });
      }
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

/** Account deletion must detect a failed stop, not silently continue
 * and erase the identity while native Tor still holds it in memory.
 */
export async function onionStopForAccountDeletion(): Promise<void> {
  stopPolling();
  if (isTorNativeAvailable()) await TorTransport.stop();
  notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
}

export async function onionClearNativeInboxForAccountDeletion(): Promise<void> {
  if (isTorNativeAvailable()) await TorTransport.clearInbound();
}

export async function onionShutdownNative(): Promise<void> {
  stopPolling();
  if (isTorNativeAvailable()) await TorTransport.stop().catch(() => undefined);
  notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
}
