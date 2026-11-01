// ============================================================================
//  Messaging facade over the Tor onion engine.
//  Peers are addressed only by `.onion`. Messages live in Dexie `messages`;
//  the engine owns the sealed outbox and the DELIVERED_ACK lifecycle.
// ============================================================================

import { dbGet, dbGetAll, dbPut, dbPutStrict } from "./storage";
import { dxdb, upsertContact, type StoredMessage } from "./dexie-db";
import {
  onionEnsureConnection,
  onionIsConnectedTo,
  onionOnConnectionChange,
  onionOnDelivery,
  onionRegisterIncomingListener,
  onionSendDispatch,
} from "./onion-engine";
import { isValidOnion } from "./onion-id";

export interface P2PMessage {
  id: string;
  from: string;
  to: string;
  text: string;
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

const messageListeners = new Set<(msg: P2PMessage) => void>();

// Notify the UI ONLY with the validated record committed by the onion engine.
// The raw authenticated frame is still untrusted JSON and must not be spread
// into UI message objects (which could reintroduce spoofed URLs/status fields).
onionRegisterIncomingListener((payload) => {
  if (payload.type !== "text_message" ||
      typeof payload.id !== "string" || typeof payload.from !== "string") return;
  void (async () => {
    const stored = await dxdb.messages.get(payload.id as string);
    if (!stored || stored.from !== payload.from || stored.to !== payload.to) return;
    const msg = { ...stored } as unknown as P2PMessage;
    messageListeners.forEach((cb) => {
      try {
        cb(msg);
      } catch (error) {
        console.warn("[p2p] listener failed", error);
      }
    });
  })().catch((error) => console.warn("[p2p] failed to load verified incoming message", error));
});

// ─── Outbound ────────────────────────────────────────────────

/**
 * Store the message locally ('pending') and hand it to the sealed outbox.
 * Returns true when the peer's hidden service accepted the bytes ('sent');
 * 'delivered' arrives later via onDeliveryUpdate.
 */
export async function sendP2PMessage(toOnion: string, message: P2PMessage): Promise<boolean> {
  const stored: P2PMessage = { ...message, to: toOnion, status: "pending" };
  // Local-only chats (built-in support bot) never touch the network.
  if (!isValidOnion(toOnion)) {
    await saveLocalMessage({ ...stored, status: "delivered" });
    return false;
  }
  await saveLocalMessage(stored);
  const { url: _u, ...mediaNoUrl } = stored.media || ({} as NonNullable<P2PMessage["media"]>);
  void _u;
  const wire = { ...stored, media: stored.media ? { ...mediaNoUrl, url: "" } : undefined };
  return onionSendDispatch(toOnion, { type: "text_message", ...wire } as Record<string, unknown>);
}

export function connectToPeer(onion: string): void {
  if (isValidOnion(onion)) void onionEnsureConnection(onion).catch(() => false);
}

// ─── Local persistence (Dexie) ───────────────────────────────

export async function saveLocalMessage(msg: P2PMessage): Promise<void> {
  await dxdb.messages.put(msg as unknown as StoredMessage);
}

export async function deleteLocalMessage(id: string): Promise<void> {
  await dxdb.messages.delete(id);
}

export async function purgeExpiredLocalMessages(): Promise<number> {
  const now = Date.now();
  const expired = await dxdb.messages
    .filter((m) => typeof m.deleteAt === "number" && (m.deleteAt as number) <= now)
    .primaryKeys();
  await dxdb.transaction("rw", [dxdb.messages, dxdb.outbox], async () => {
    await dxdb.messages.bulkDelete(expired);
    await dxdb.outbox.bulkDelete(expired);
  });
  return expired.length;
}

export async function clearMessagesForChat(peer: string): Promise<void> {
  const ids = await dxdb.messages.filter((m) => m.from === peer || m.to === peer).primaryKeys();
  await dxdb.messages.bulkDelete(ids);
}

export async function getMessagesForChat(peer: string): Promise<P2PMessage[]> {
  const now = Date.now();
  const rows = await dxdb.messages.filter((m) => m.from === peer || m.to === peer).toArray();
  return (rows as unknown as P2PMessage[])
    .filter((m) => !m.deleteAt || m.deleteAt > now)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** One-time move of messages from the legacy key-value DB into Dexie. */
export async function migrateLegacyMessages(): Promise<void> {
  if (await dbGet<boolean>("settings", "messages-migrated-to-dexie")) return;
  const legacy = await dbGetAll<P2PMessage>("messages");
  // Migration may be retried after a crash. Never replace a newer Dexie
  // message or its read/consumed state with an obsolete legacy copy.
  if (legacy.length) await dxdb.transaction("rw", dxdb.messages, async () => {
    for (const msg of legacy) {
      if (typeof msg?.id !== "string" || !msg.id || msg.id.length > 128) continue;
      if (!(await dxdb.messages.get(msg.id))) {
        await dxdb.messages.add(msg as unknown as StoredMessage);
      }
    }
  });
  // Mark complete only if the write to settings actually committed.
  await dbPutStrict("settings", "messages-migrated-to-dexie", true);
}

// ─── Chat metadata (display name → Dexie contacts) ───────────

export async function saveChatMeta(meta: ChatMeta): Promise<void> {
  await dbPut("contacts", meta.friendId, meta);
  if (isValidOnion(meta.friendId)) await upsertContact(meta.friendId, meta.friendName);
}

export async function getChatMeta(friendId: string): Promise<ChatMeta | undefined> {
  return dbGet<ChatMeta>("contacts", friendId);
}

export async function getAllChatMetas(): Promise<ChatMeta[]> {
  return dbGetAll<ChatMeta>("contacts");
}

// ─── Listener API ────────────────────────────────────────────

export function onP2PMessage(cb: (msg: P2PMessage) => void): () => void {
  messageListeners.add(cb);
  return () => void messageListeners.delete(cb);
}

export function onConnectionChange(cb: (peer: string, connected: boolean) => void): () => void {
  return onionOnConnectionChange(cb);
}

/** 'sent' = remote socket accepted; 'delivered' = verified DELIVERED_ACK. */
export function onDeliveryUpdate(
  cb: (messageId: string, state: "sent" | "delivered") => void,
): () => void {
  return onionOnDelivery(cb);
}

export function isConnectedTo(peer: string): boolean {
  return onionIsConnectedTo(peer);
}
