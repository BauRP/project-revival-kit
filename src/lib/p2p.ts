// ============================================================================
//  P2P messaging service — 100% peer-to-peer over Tor Hidden Services.
//  ---------------------------------------------------------------------------
//  Signalling: NONE. Every device hosts its own Tor v3 Onion Service.
//  Transport : Tor circuit → peer hidden service (see onion-engine.ts),
//              framed with Ed25519 signatures over the payload envelope.
//  Persistence: Dexie pending_messages queue, mirrored into the native outbox
//              so the Android foreground service retries while the app sleeps.
//  No centralized server, no STUN, no TURN, no signalling of any kind.
// ============================================================================

import { dbDelete, dbGet, dbPut, dbGetAll } from "./storage";
import {
  rtcInit,
  rtcDial,
  rtcEnsureConnection,
  rtcIsConnectedTo,
  rtcOnConnectionChange,
  rtcRegisterIncomingListener,
} from "./onion-engine";
import {
  enqueuePending,
  markPendingDelivered,
  getPendingFor,
} from "./dexie-db";

export interface P2PMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  ciphertext?: string;
  nonce?: string;
  timestamp: number;
  status: "pending" | "sent" | "delivered" | "read";
  media?: {
    id: string;
    fileId?: string;
    type: "image" | "audio" | "file";
    url: string;
    name: string;
    size: number;
    mimeType: string;
  };
  caption?: string;
  deleteAt?: number;
  silent?: boolean;
  oneTimeView?: boolean;
  roundVideo?: boolean;
  scheduledAt?: number;
}

export interface ChatMeta {
  friendId: string;
  friendName: string;
  friendAvatar?: string | null;
  lastMessage: string;
  lastMessageTime: number;
  unread: number;
  started: boolean;
}

// ─── External listener registries (preserved API) ────────────

const messageListeners: Set<(msg: P2PMessage) => void> = new Set();
const connectionListeners: Set<(peerId: string, connected: boolean) => void> = new Set();

// Bridge: every inbound dispatch frame of kind "text_message" surfaces as a P2PMessage.
rtcRegisterIncomingListener((payload: any) => {
  if (!payload || payload.type !== "text_message") return;
  const msg: P2PMessage = {
    id: payload.id,
    from: payload.from,
    to: payload.to,
    text: payload.text || "",
    ciphertext: payload.ciphertext,
    nonce: payload.nonce,
    timestamp: payload.timestamp || Date.now(),
    status: "delivered",
    media: payload.media,
    caption: payload.caption,
    deleteAt: payload.deleteAt,
    silent: payload.silent,
    oneTimeView: payload.oneTimeView,
    roundVideo: payload.roundVideo,
    scheduledAt: payload.scheduledAt,
  };
  if (!msg.id || !msg.from) return;
  void saveMessage(msg);
  messageListeners.forEach((cb) => {
    try {
      cb(msg);
    } catch {
      /* swallow */
    }
  });
});

// Bridge connection events into the legacy API.
rtcOnConnectionChange((userId, connected) => {
  connectionListeners.forEach((cb) => {
    try {
      cb(userId, connected);
    } catch {
      /* swallow */
    }
  });
});

// ─── Bootstrap ───────────────────────────────────────────────

export async function initPeer(userId: string): Promise<string> {
  return rtcInit(userId);
}

// ─── Outbound ────────────────────────────────────────────────

export async function sendP2PMessage(
  toPeerId: string,
  message: P2PMessage,
): Promise<boolean> {
  // Try to bring the connection up (no-op if already verified).
  const live = await rtcEnsureConnection(toPeerId).catch(() => false);

  if (live && rtcIsConnectedTo(toPeerId)) {
    // sendTrivoTextMessage is the canonical dispatch surface (lives in
    // trivo-server.ts and routes through the WebRTC engine).
    const { sendTrivoTextMessage } = await import("./trivo-server");
    const ok = sendTrivoTextMessage({
      type: "text_message",
      ...message,
    } as unknown as Record<string, unknown>);
    if (ok) {
      message.status = "sent";
      await saveMessage(message);
      return true;
    }
  }

  // Persist and queue for later drain.
  message.status = "pending";
  await saveMessage(message);
  await enqueuePending({
    id: message.id,
    targetUserId: toPeerId,
    senderUserId: message.from,
    kind: "text_message",
    payload: { type: "text_message", ...message } as unknown as Record<string, unknown>,
    blobFileId: message.media?.fileId,
  });
  return false;
}

export function connectToPeer(peerId: string): null {
  // Backwards-compat shim: the WebRTC engine dials lazily on send.
  void rtcDial(peerId).catch(() => {});
  return null;
}

export async function flushPendingMessages(peerId: string): Promise<void> {
  // The engine drains automatically on verify, but ChatRoom may call us
  // explicitly. Re-attempt any text_message envelopes for this peer.
  const queued = await getPendingFor(peerId);
  if (queued.length === 0) return;
  if (!rtcIsConnectedTo(peerId)) {
    await rtcEnsureConnection(peerId).catch(() => false);
  }
  if (!rtcIsConnectedTo(peerId)) return;
  const { sendTrivoTextMessage } = await import("./trivo-server");
  for (const rec of queued) {
    const ok = sendTrivoTextMessage(rec.payload);
    if (!ok) return;
    await markPendingDelivered(rec.id);
    if (rec.kind === "text_message") {
      const msg = rec.payload as unknown as P2PMessage;
      if (msg?.id) {
        const existing = await dbGet<P2PMessage>("messages", msg.id);
        if (existing) {
          existing.status = "sent";
          await dbPut("messages", msg.id, existing);
        }
      }
    }
  }
}

// ─── Local persistence ───────────────────────────────────────

async function saveMessage(msg: P2PMessage): Promise<void> {
  await dbPut("messages", msg.id, msg);
}

export async function purgeExpiredLocalMessages(): Promise<number> {
  const all = await dbGetAll<P2PMessage>("messages");
  const expired = all.filter((m) => !!m.deleteAt && m.deleteAt <= Date.now());
  await Promise.all(expired.map((m) => dbDelete("messages", m.id)));
  return expired.length;
}

export async function clearMessagesForChat(friendId: string): Promise<void> {
  const all = await dbGetAll<P2PMessage>("messages");
  const related = all.filter((m) => m.from === friendId || m.to === friendId);
  await Promise.all(related.map((m) => dbDelete("messages", m.id)));
}

export async function getMessagesForChat(friendId: string): Promise<P2PMessage[]> {
  const all = await dbGetAll<P2PMessage>("messages");
  return all
    .filter((m) => m.from === friendId || m.to === friendId)
    .filter((m) => !m.deleteAt || m.deleteAt > Date.now())
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Chat metadata ───────────────────────────────────────────

export async function saveChatMeta(meta: ChatMeta): Promise<void> {
  await dbPut("contacts", meta.friendId, meta);
}

export async function getChatMeta(friendId: string): Promise<ChatMeta | undefined> {
  return dbGet<ChatMeta>("contacts", friendId);
}

export async function getAllChatMetas(): Promise<ChatMeta[]> {
  return dbGetAll<ChatMeta>("contacts");
}

// ─── Listener API (preserved) ────────────────────────────────

export function onP2PMessage(cb: (msg: P2PMessage) => void): () => void {
  messageListeners.add(cb);
  return () => {
    messageListeners.delete(cb);
  };
}

export function onConnectionChange(
  cb: (peerId: string, connected: boolean) => void,
): () => void {
  connectionListeners.add(cb);
  return () => {
    connectionListeners.delete(cb);
  };
}

export function getPeerId(): string | null {
  // The engine owns this — leave null for legacy callers that only do truthy checks.
  return null;
}

export function isConnectedTo(peerId: string): boolean {
  return rtcIsConnectedTo(peerId);
}

export function destroyPeer(): void {
  // Engine retains its socket so other tabs/components keep working.
}
