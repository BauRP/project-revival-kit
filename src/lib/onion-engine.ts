// ============================================================================
//  Trivo Onion Engine — Tor Hidden Service transport.
//  ---------------------------------------------------------------------------
//  This module fully replaces the previous WebRTC/PeerJS mesh. There is no
//  STUN, no TURN, no signalling server and no relay of any kind:
//
//    * Every device hosts its OWN v3 Onion Service (native tor daemon inside a
//      foreground service — see android/.../tor/*.java).
//    * A peer is addressed exclusively by its `<56chars>.onion` hostname.
//    * Outbound frames are dialled through the local Tor SOCKS5 port straight
//      into the peer's hidden service (end-to-end inside the Tor circuit,
//      plus our own Ed25519 signatures and NaCl payload encryption).
//    * Anything that cannot be delivered right now is persisted in IndexedDB
//      (Dexie `pending_messages`) AND mirrored into the native outbox so the
//      foreground service keeps retrying while the WebView is dead.
//    * A 5 s "smart poll" loop drains inbound frames, retries the outbox and
//      refreshes peer reachability (online / last seen).
//
//  Legacy `rtc*` names are kept as exports so existing call sites compile
//  unchanged — but the implementation underneath is 100 % Tor.
// ============================================================================

import {
  TorTransport,
  isTorNativeAvailable,
  TOR_UNAVAILABLE_STATUS,
  type TorStatus,
} from "./tor-native";
import { getOrCreateIdentity } from "./crypto";
import { signDataAsync, verifySignatureAsync, parseJsonAsync } from "./crypto-async";
import {
  enqueuePending,
  getPendingFor,
  markPendingDelivered,
  setPendingInFlight,
  getAllQueuedPending,
  saveContactKeys,
  getContactKeys,
  setContactLastSeen,
  setContactOnion,
  getContactOnion,
  getAllContacts,
  getBlob,
  putBlob,
  hasBlob,
} from "./dexie-db";

// ─── Constants ───────────────────────────────────────────────

/** Virtual port exposed by every Trivo onion service. */
export const ONION_SERVICE_PORT = 8443;
/** Smart-poll cadence mandated by the transport spec. */
export const POLL_INTERVAL_MS = 5_000;
/** Base64 payload slice per blob chunk frame (~48 KiB raw). */
const BLOB_CHUNK_BYTES = 48 * 1024;
/** A peer is considered "online" if it answered a probe within this window. */
const ONLINE_TTL_MS = 30_000;
const BLOB_REQUEST_TIMEOUT_MS = 120_000;

// ─── Frame model ─────────────────────────────────────────────

export type OnionFrameKind =
  | "hello"
  | "dispatch"
  | "ping"
  | "pong"
  | "blob_request"
  | "blob_chunk"
  | "blob_sync_request"
  | "blob_missing";

export interface OnionFrame {
  v: 1;
  kind: OnionFrameKind;
  from: string;
  fromOnion: string;
  fromSigningKey: string;
  fromExchangeKey: string;
  to: string;
  ts: number;
  body: Record<string, unknown>;
  sig: string;
}

// ─── Local state ─────────────────────────────────────────────

let selfUserId: string | null = null;
let selfOnion: string | null = null;
let torStatus: TorStatus = { ...TOR_UNAVAILABLE_STATUS };
let identityCache: Awaited<ReturnType<typeof getOrCreateIdentity>> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let starting: Promise<string> | null = null;

const incomingDispatchListeners = new Set<(payload: any) => void>();
const connectionListeners = new Set<(userId: string, connected: boolean) => void>();
const statusListeners = new Set<(status: TorStatus) => void>();

/** userId → last successful contact (ms). */
const reachability = new Map<string, number>();
/** fileId → resolver for an in-flight blob pull. */
const blobRequests = new Map<string, (ok: boolean) => void>();
/** fileId → partial receive state (resumable transfers). */
interface PartialReceive {
  fileId: string;
  fromUserId: string;
  name: string;
  mimeType: string;
  totalChunks: number;
  received: Map<number, string>;
  updatedAt: number;
}
const partialReceives = new Map<string, PartialReceive>();
/** Frames already processed (replay / duplicate protection). */
const seenFrames = new Set<string>();

// ─── Listener registration (public, stable API) ──────────────

export function onionRegisterIncomingListener(cb: (payload: any) => void): () => void {
  incomingDispatchListeners.add(cb);
  return () => {
    incomingDispatchListeners.delete(cb);
  };
}

export function onionOnConnectionChange(
  cb: (userId: string, connected: boolean) => void,
): () => void {
  connectionListeners.add(cb);
  return () => {
    connectionListeners.delete(cb);
  };
}

export function onionOnStatus(cb: (status: TorStatus) => void): () => void {
  statusListeners.add(cb);
  cb(torStatus);
  return () => {
    statusListeners.delete(cb);
  };
}

function notifyConnection(userId: string, connected: boolean): void {
  connectionListeners.forEach((cb) => {
    try {
      cb(userId, connected);
    } catch {
      /* listener errors never break the transport */
    }
  });
}

function notifyStatus(status: TorStatus): void {
  torStatus = status;
  statusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch {
      /* swallow */
    }
  });
}

function dispatchInbound(payload: any): void {
  incomingDispatchListeners.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      /* swallow */
    }
  });
}

// ─── Identity + signing ──────────────────────────────────────

async function identity() {
  if (!identityCache) identityCache = await getOrCreateIdentity();
  return identityCache;
}

function canonical(
  kind: string,
  from: string,
  to: string,
  ts: number,
  body: Record<string, unknown>,
): string {
  return `${kind}|${from}|${to}|${ts}|${JSON.stringify(body)}`;
}

async function buildFrame(
  kind: OnionFrameKind,
  to: string,
  body: Record<string, unknown>,
): Promise<OnionFrame> {
  const id = await identity();
  const from = selfUserId || "";
  const ts = Date.now();
  const sig = await signDataAsync(canonical(kind, from, to, ts, body), id.signing.secretKey);
  return {
    v: 1,
    kind,
    from,
    fromOnion: selfOnion || "",
    fromSigningKey: id.signing.publicKey,
    fromExchangeKey: id.exchange.publicKey,
    to,
    ts,
    body,
    sig,
  };
}

async function verifyFrame(frame: OnionFrame): Promise<boolean> {
  if (!frame || frame.v !== 1 || !frame.from || !frame.sig || !frame.fromSigningKey) return false;
  // Trust-on-first-use, then pin: a known contact must keep the same key.
  const known = await getContactKeys(frame.from);
  const pinned = known?.signingKey;
  if (pinned && pinned !== frame.fromSigningKey) {
    console.warn("[onion] signing key mismatch for", frame.from, "— frame rejected");
    return false;
  }
  const data = canonical(frame.kind, frame.from, frame.to, frame.ts, frame.body);
  return verifySignatureAsync(data, frame.sig, frame.fromSigningKey);
}

// ─── Bootstrap ───────────────────────────────────────────────

const ONION_KEY_STORAGE = "trivo:onion:secret-key";

function readStoredOnionKey(): string | null {
  try {
    return localStorage.getItem(ONION_KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeStoredOnionKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(ONION_KEY_STORAGE, key);
  } catch {
    /* best effort */
  }
}

/**
 * Boot the native tor daemon, publish this device's hidden service and start
 * the 5 s poll loop. Resolves with the local `.onion` hostname.
 */
export async function onionInit(userId: string): Promise<string> {
  if (!userId) throw new Error("onionInit: userId required");
  if (selfUserId === userId && selfOnion) return selfOnion;
  if (starting) return starting;

  starting = (async () => {
    selfUserId = userId;
    await identity();

    if (!isTorNativeAvailable()) {
      notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
      startPolling(); // still drains the local queue bookkeeping
      throw new Error("TOR_UNAVAILABLE: native Android runtime required");
    }

    await bindNativeListeners();

    const res = await TorTransport.start({
      label: userId,
      secretKey: readStoredOnionKey(),
    });
    if (res.secretKey) writeStoredOnionKey(res.secretKey);
    selfOnion = res.onion;
    notifyStatus({
      running: res.running,
      bootstrapped: res.bootstrapped,
      bootstrapPercent: res.bootstrapPercent,
      onion: res.onion,
      socksPort: res.socksPort,
      servicePort: res.servicePort,
      lastError: res.lastError ?? null,
    });

    startPolling();
    void drainOutbox();
    return res.onion || "";
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function bindNativeListeners(): Promise<void> {
  if (listenersBound) return;
  listenersBound = true;
  await TorTransport.addListener("onionMessage", (evt) => {
    void handleRawFrame(evt.frame);
  });
  await TorTransport.addListener("onionStatus", (status) => {
    if (status.onion) selfOnion = status.onion;
    notifyStatus(status);
  });
}

/** The local hidden-service hostname, or null before bootstrap completes. */
export function onionSelfAddress(): string | null {
  return selfOnion;
}

export function onionCurrentStatus(): TorStatus {
  return torStatus;
}

// ─── Address book ────────────────────────────────────────────

/** Register/refresh the onion hostname a userId is reachable at. */
export async function onionRegisterPeer(userId: string, onion: string): Promise<void> {
  if (!userId || !onion) return;
  await setContactOnion(userId, normalizeOnion(onion));
}

function normalizeOnion(value: string): string {
  const trimmed = (value || "").trim().toLowerCase();
  const stripped = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  return stripped;
}

function looksLikeOnion(value: string): boolean {
  return /^[a-z2-7]{56}\.onion$/.test(normalizeOnion(value));
}

/**
 * Resolve a userId to an onion hostname. A userId that IS an onion address is
 * accepted verbatim (that is how contacts are exchanged offline via QR).
 */
export async function resolvePeerOnion(userId: string): Promise<string | null> {
  if (!userId) return null;
  if (looksLikeOnion(userId)) return normalizeOnion(userId);
  const stored = await getContactOnion(userId);
  return stored ? normalizeOnion(stored) : null;
}

// ─── Outbound ────────────────────────────────────────────────

async function shipFrame(
  targetUserId: string,
  frame: OnionFrame,
  frameId: string,
): Promise<boolean> {
  const onion = await resolvePeerOnion(targetUserId);
  if (!onion) return false;
  if (!isTorNativeAvailable()) return false;
  try {
    const res = await TorTransport.send({
      id: frameId,
      onion: `${onion}:${ONION_SERVICE_PORT}`,
      frame: JSON.stringify(frame),
    });
    if (res.delivered) {
      reachability.set(targetUserId, Date.now());
      await setContactLastSeen(targetUserId, Date.now());
      notifyConnection(targetUserId, true);
      return true;
    }
  } catch (e) {
    console.warn("[onion] send failed", e);
  }
  notifyConnection(targetUserId, false);
  return false;
}

/**
 * Fire-and-persist dispatch. Returns true when the frame reached the peer's
 * hidden service on this attempt; false means it now lives in the outbox.
 */
export async function onionSendDispatch(
  targetUserId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!targetUserId) return false;
  const frame = await buildFrame("dispatch", targetUserId, { payload });
  const frameId =
    (payload.id as string | undefined) ||
    `frm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ok = await shipFrame(targetUserId, frame, frameId);
  if (ok) return true;
  await queueForLater(targetUserId, frameId, frame, payload);
  return false;
}

async function queueForLater(
  targetUserId: string,
  frameId: string,
  frame: OnionFrame,
  payload: Record<string, unknown>,
): Promise<void> {
  const kindRaw = typeof payload.type === "string" ? (payload.type as string) : "text_message";
  const allowed = [
    "text_message",
    "friend_request",
    "friend_request_status",
    "message_status",
    "message_lifecycle",
  ];
  await enqueuePending({
    id: frameId,
    targetUserId,
    senderUserId: selfUserId || "",
    kind: (allowed.includes(kindRaw) ? kindRaw : "text_message") as never,
    payload,
    frame: JSON.stringify(frame),
    blobFileId:
      typeof (payload.media as { fileId?: string } | undefined)?.fileId === "string"
        ? (payload.media as { fileId?: string }).fileId
        : undefined,
  });
  // Mirror into the native outbox so delivery continues with the app closed.
  const onion = await resolvePeerOnion(targetUserId);
  if (onion && isTorNativeAvailable()) {
    try {
      await TorTransport.enqueue({
        id: frameId,
        onion: `${onion}:${ONION_SERVICE_PORT}`,
        frame: JSON.stringify(frame),
      });
    } catch {
      /* JS poll loop is the fallback */
    }
  }
}

/** Blocking-ish reachability probe through the Tor SOCKS port. */
export async function onionProbe(userId: string): Promise<boolean> {
  const onion = await resolvePeerOnion(userId);
  if (!onion || !isTorNativeAvailable()) return false;
  try {
    const res = await TorTransport.probe({ onion: `${onion}:${ONION_SERVICE_PORT}` });
    if (res.reachable) {
      reachability.set(userId, Date.now());
      await setContactLastSeen(userId, Date.now());
    }
    notifyConnection(userId, res.reachable);
    return res.reachable;
  } catch {
    notifyConnection(userId, false);
    return false;
  }
}

/** True when the peer answered within the online TTL window. */
export function onionIsConnectedTo(userId: string): boolean {
  const last = reachability.get(userId);
  return !!last && Date.now() - last < ONLINE_TTL_MS;
}

/** Bring a peer "up": probe + drain everything queued for it. */
export async function onionEnsureConnection(userId: string): Promise<boolean> {
  if (onionIsConnectedTo(userId)) return true;
  const ok = await onionProbe(userId);
  if (ok) {
    await sendHello(userId);
    await drainOutboxFor(userId);
  }
  return ok;
}

async function sendHello(userId: string): Promise<void> {
  const frame = await buildFrame("hello", userId, { onion: selfOnion });
  await shipFrame(userId, frame, `hello-${Date.now()}`);
}

// ─── Blob transfer (resumable, chunked over onion) ───────────

export function onionRequestBlob(fileId: string): Promise<boolean> {
  if (!fileId) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    blobRequests.set(fileId, resolve);
    void (async () => {
      const contacts = await getAllContacts();
      const targets = contacts
        .filter((c) => !!c.onionAddress)
        .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      let asked = false;
      for (const c of targets) {
        const partial = partialReceives.get(fileId);
        const frame = await buildFrame("blob_request", c.userId, {
          fileId,
          have: partial ? Array.from(partial.received.keys()) : [],
        });
        const sent = await shipFrame(c.userId, frame, `blobreq-${fileId}-${c.userId}`);
        asked = asked || sent;
      }
      if (!asked) {
        blobRequests.delete(fileId);
        resolve(false);
      }
    })();
    setTimeout(() => {
      if (blobRequests.has(fileId)) {
        blobRequests.delete(fileId);
        resolve(false);
      }
    }, BLOB_REQUEST_TIMEOUT_MS);
  });
}

async function respondToBlobRequest(
  requesterUserId: string,
  fileId: string,
  have: number[],
): Promise<void> {
  const rec = await getBlob(fileId);
  if (!rec) {
    const frame = await buildFrame("blob_missing", requesterUserId, { fileId });
    await shipFrame(requesterUserId, frame, `blobmiss-${fileId}`);
    return;
  }
  const buffer = new Uint8Array(await rec.data.arrayBuffer());
  const totalChunks = Math.max(1, Math.ceil(buffer.length / BLOB_CHUNK_BYTES));
  const already = new Set(have || []);
  for (let index = 0; index < totalChunks; index++) {
    if (already.has(index)) continue;
    const slice = buffer.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES);
    const frame = await buildFrame("blob_chunk", requesterUserId, {
      fileId,
      index,
      totalChunks,
      name: rec.name,
      mimeType: rec.mimeType,
      data: bytesToBase64(slice),
    });
    const ok = await shipFrame(requesterUserId, frame, `blobchunk-${fileId}-${index}`);
    if (!ok) return; // peer went away — the requester re-syncs on reconnect
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[],
    );
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function acceptBlobChunk(fromUserId: string, body: Record<string, unknown>): Promise<void> {
  const fileId = String(body.fileId || "");
  if (!fileId) return;
  const index = Number(body.index || 0);
  const totalChunks = Number(body.totalChunks || 1);
  const entry: PartialReceive = partialReceives.get(fileId) || {
    fileId,
    fromUserId,
    name: String(body.name || fileId),
    mimeType: String(body.mimeType || "application/octet-stream"),
    totalChunks,
    received: new Map<number, string>(),
    updatedAt: Date.now(),
  };
  entry.received.set(index, String(body.data || ""));
  entry.totalChunks = totalChunks;
  entry.updatedAt = Date.now();
  partialReceives.set(fileId, entry);

  if (entry.received.size < entry.totalChunks) return;

  const ordered: Uint8Array[] = [];
  for (let i = 0; i < entry.totalChunks; i++) {
    const part = entry.received.get(i);
    if (part === undefined) return; // gap: wait for the sync response
    ordered.push(base64ToBytes(part));
  }
  const blob = new Blob(ordered as unknown as BlobPart[], { type: entry.mimeType });
  await putBlob(fileId, blob, entry.name, entry.mimeType);
  partialReceives.delete(fileId);
  const resolver = blobRequests.get(fileId);
  if (resolver) {
    blobRequests.delete(fileId);
    resolver(true);
  }
}

/** Ask the sender for the chunk indices we are still missing. */
async function requestMissingChunks(entry: PartialReceive): Promise<void> {
  const missing: number[] = [];
  for (let i = 0; i < entry.totalChunks; i++) {
    if (!entry.received.has(i)) missing.push(i);
  }
  if (missing.length === 0) return;
  const frame = await buildFrame("blob_sync_request", entry.fromUserId, {
    fileId: entry.fileId,
    missing,
  });
  await shipFrame(entry.fromUserId, frame, `blobsync-${entry.fileId}`);
}

// ─── Inbound ─────────────────────────────────────────────────

async function handleRawFrame(raw: string): Promise<void> {
  let frame: OnionFrame;
  try {
    // Parsed in the crypto worker when large — the UI thread never blocks.
    frame = await parseJsonAsync<OnionFrame>(raw);
  } catch {
    return;
  }
  const fingerprint = `${frame.from}:${frame.kind}:${frame.ts}:${frame.sig?.slice(0, 16)}`;
  if (seenFrames.has(fingerprint)) return;
  seenFrames.add(fingerprint);
  if (seenFrames.size > 5000) {
    const first = seenFrames.values().next().value;
    if (first) seenFrames.delete(first);
  }

  if (!(await verifyFrame(frame))) return;

  // Learn/refresh the sender's identity + address (TOFU pinning).
  if (frame.fromSigningKey && frame.fromExchangeKey) {
    await saveContactKeys(frame.from, frame.fromSigningKey, frame.fromExchangeKey);
  }
  if (frame.fromOnion) await setContactOnion(frame.from, normalizeOnion(frame.fromOnion));
  reachability.set(frame.from, Date.now());
  await setContactLastSeen(frame.from, Date.now());
  notifyConnection(frame.from, true);

  switch (frame.kind) {
    case "hello": {
      const reply = await buildFrame("pong", frame.from, { onion: selfOnion });
      await shipFrame(frame.from, reply, `pong-${Date.now()}`);
      await drainOutboxFor(frame.from);
      break;
    }
    case "ping": {
      const reply = await buildFrame("pong", frame.from, { onion: selfOnion });
      await shipFrame(frame.from, reply, `pong-${Date.now()}`);
      break;
    }
    case "pong":
      break;
    case "dispatch": {
      const payload = (frame.body?.payload || null) as Record<string, unknown> | null;
      if (payload) dispatchInbound(payload);
      break;
    }
    case "blob_request": {
      const fileId = String(frame.body.fileId || "");
      const have = Array.isArray(frame.body.have) ? (frame.body.have as number[]) : [];
      if (await hasBlob(fileId)) await respondToBlobRequest(frame.from, fileId, have);
      else {
        const miss = await buildFrame("blob_missing", frame.from, { fileId });
        await shipFrame(frame.from, miss, `blobmiss-${fileId}`);
      }
      break;
    }
    case "blob_sync_request": {
      const fileId = String(frame.body.fileId || "");
      const missing = Array.isArray(frame.body.missing) ? (frame.body.missing as number[]) : [];
      const rec = await getBlob(fileId);
      if (!rec) break;
      const buffer = new Uint8Array(await rec.data.arrayBuffer());
      const totalChunks = Math.max(1, Math.ceil(buffer.length / BLOB_CHUNK_BYTES));
      for (const index of missing) {
        const slice = buffer.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES);
        const chunk = await buildFrame("blob_chunk", frame.from, {
          fileId,
          index,
          totalChunks,
          name: rec.name,
          mimeType: rec.mimeType,
          data: bytesToBase64(slice),
        });
        const ok = await shipFrame(frame.from, chunk, `blobchunk-${fileId}-${index}`);
        if (!ok) break;
      }
      break;
    }
    case "blob_chunk":
      await acceptBlobChunk(frame.from, frame.body);
      break;
    case "blob_missing": {
      const fileId = String(frame.body.fileId || "");
      const resolver = blobRequests.get(fileId);
      if (resolver && !partialReceives.has(fileId)) {
        blobRequests.delete(fileId);
        resolver(false);
      }
      break;
    }
    default:
      break;
  }
}

// ─── Outbox drain ────────────────────────────────────────────

async function drainOutboxFor(targetUserId: string): Promise<void> {
  const queued = await getPendingFor(targetUserId);
  for (const rec of queued) {
    await setPendingInFlight(rec.id);
    const frame: OnionFrame = rec.frame
      ? await parseJsonAsync<OnionFrame>(rec.frame)
      : await buildFrame("dispatch", targetUserId, { payload: rec.payload });
    const ok = await shipFrame(targetUserId, frame, rec.id);
    if (!ok) return; // peer offline again — keep the rest queued, order preserved
    await markPendingDelivered(rec.id);
    if (isTorNativeAvailable()) {
      try {
        await TorTransport.dequeue({ id: rec.id });
      } catch {
        /* native mirror is best effort */
      }
    }
  }
}

/** Retry every queued frame for every peer that currently answers. */
export async function drainOutbox(): Promise<void> {
  const queued = await getAllQueuedPending();
  const targets = Array.from(new Set(queued.map((q) => q.targetUserId)));
  for (const target of targets) {
    if (!(await resolvePeerOnion(target))) continue;
    await drainOutboxFor(target);
  }
}

// ─── Smart poll loop (5 s) ───────────────────────────────────

let polling = false;

async function pollTick(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    if (isTorNativeAvailable()) {
      // 1. Frames the foreground service buffered while the WebView slept.
      const inbound = await TorTransport.drainInbound().catch(() => ({ frames: [] as string[] }));
      for (const raw of inbound.frames) await handleRawFrame(raw);

      // 2. Frames the native outbox delivered in the background.
      const delivered = await TorTransport.drainDelivered().catch(() => ({ ids: [] as string[] }));
      for (const id of delivered.ids) await markPendingDelivered(id);

      // 3. Status refresh.
      const status = await TorTransport.getStatus().catch(() => torStatus);
      if (status.onion) selfOnion = status.onion;
      notifyStatus(status);
    }

    // 4. Retry the JS outbox.
    await drainOutbox();

    // 5. Re-ask for gaps in partially received blobs (resumable transfers).
    for (const entry of partialReceives.values()) {
      if (Date.now() - entry.updatedAt > POLL_INTERVAL_MS * 2) {
        await requestMissingChunks(entry);
      }
    }

    // 6. Expire stale presence.
    for (const [userId, ts] of reachability) {
      if (Date.now() - ts >= ONLINE_TTL_MS) {
        reachability.delete(userId);
        notifyConnection(userId, false);
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
  pollTimer = setInterval(() => {
    void pollTick();
  }, POLL_INTERVAL_MS);
  void pollTick();
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function onionDestroy(): void {
  stopPolling();
  // The tor daemon deliberately keeps running inside the foreground service so
  // messages continue to arrive; call TorTransport.stop() explicitly to kill it.
}

export async function onionShutdownNative(): Promise<void> {
  stopPolling();
  if (isTorNativeAvailable()) {
    await TorTransport.stop().catch(() => undefined);
  }
  notifyStatus({ ...TOR_UNAVAILABLE_STATUS });
}

// ─── Legacy-compatible aliases (call sites unchanged) ────────

export const rtcRegisterIncomingListener = onionRegisterIncomingListener;
export const rtcOnConnectionChange = onionOnConnectionChange;
export const rtcInit = onionInit;
export const rtcIsConnectedTo = onionIsConnectedTo;
export const rtcEnsureConnection = onionEnsureConnection;
export const rtcRequestBlob = onionRequestBlob;
export const rtcDestroy = onionDestroy;

export async function rtcDial(remoteUserId: string): Promise<boolean> {
  return onionEnsureConnection(remoteUserId);
}

/**
 * Legacy synchronous signature. The onion send is inherently asynchronous, so
 * this returns `true` when the frame was accepted for delivery (live or
 * queued) and kicks the real dispatch in the background.
 */
export function rtcSendDispatch(targetUserId: string, payload: Record<string, unknown>): boolean {
  if (!targetUserId) return false;
  void onionSendDispatch(targetUserId, payload);
  return onionIsConnectedTo(targetUserId);
}
