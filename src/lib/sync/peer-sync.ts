// ============================================================================
//  Trivo Chat Elite — offline sync layer (100% P2P, zero remote server)
//  ---------------------------------------------------------------------------
//  This module used to depend on a centralized Node.js backend over HTTP.
//  Every remote endpoint has been removed. Friend requests, offline message
//  buffering, status updates and the startup handshake are now powered
//  exclusively by the local Dexie pending queue + the WebRTC P2P engine
//  (see src/lib/onion-engine.ts and src/lib/trivo-server.ts).
//
//  Public API preserved 1:1 so callers (Index.tsx, ChatRoom.tsx,
//  AddFriend.tsx) keep working without changes.
// ============================================================================

import { sendTrivoTextMessage, onTrivoMessage, initTrivoServer } from "../trivo-server";
import { dbPut, dbGet, dbGetAll } from "../storage";
import { dxdb } from "../dexie-db";
import type { P2PMessage, ChatMeta } from "../p2p";
import { isExpired } from "../chat-preferences";

// ─── Friend Requests ────────────────────────────────────────

export interface FriendRequest {
  id?: string;
  from: string;
  to: string;
  fromName: string;
  signingKey: string;
  exchangeKey: string;
  timestamp: number;
  status: "pending" | "accepted" | "declined";
}

/**
 * Send a friend request — broadcast via the P2P engine. If the recipient is
 * offline the envelope persists in Dexie's pending_messages table and is
 * drained automatically the moment the peer reconnects.
 */
export async function sendFriendRequest(request: FriendRequest): Promise<void> {
  const payload = {
    ...request,
    timestamp: Date.now(),
    status: "pending" as const,
  };

  sendTrivoTextMessage({
    type: "friend_request",
    id: `fr-${payload.from}-${payload.to}-${payload.timestamp}`,
    from: payload.from,
    to: payload.to,
    fromName: payload.fromName,
    signingKey: payload.signingKey,
    exchangeKey: payload.exchangeKey,
    timestamp: payload.timestamp,
    status: payload.status,
  } as unknown as Record<string, unknown>);

  // Local mirror so the sender sees "pending" immediately.
  await dbPut("settings", `friend-req-out-${request.to}`, payload);
}

/**
 * Listen for incoming friend requests over the P2P dispatch channel.
 * Replays any buffered requests already cached locally (settings store).
 */
export function listenForFriendRequests(
  userId: string,
  onRequest: (req: FriendRequest) => void,
): () => void {
  initTrivoServer(userId);

  // Replay any locally cached unanswered request.
  (async () => {
    try {
      const all = (await dbGetAll<FriendRequest>("settings")) as FriendRequest[];
      if (!Array.isArray(all)) return;
      all.forEach((r) => {
        if (!r || typeof r !== "object") return;
        if (r.to !== userId) return;
        if (r.status !== "pending") return;
        onRequest(r);
      });
    } catch {
      /* ignore */
    }
  })();

  const off = onTrivoMessage((data) => {
    if (!data || data.type !== "friend_request") return;
    if (data.to !== userId) return;
    if (data.status && data.status !== "pending") return;
    onRequest({
      from: data.from,
      to: userId,
      fromName: data.fromName || String(data.from || "").substring(0, 8),
      signingKey: data.signingKey || "",
      exchangeKey: data.exchangeKey || "",
      timestamp: data.timestamp || Date.now(),
      status: "pending",
    });
  });

  return () => {
    try {
      off();
    } catch {}
  };
}

/**
 * Accept a friend request — broadcast acceptance to the original sender.
 */
export async function acceptFriendRequest(fromId: string, toId: string): Promise<void> {
  sendTrivoTextMessage({
    type: "friend_request_status",
    id: `frs-${fromId}-${toId}-${Date.now()}`,
    from: toId,
    to: fromId,
    requestFrom: fromId,
    requestTo: toId,
    status: "accepted",
    timestamp: Date.now(),
  } as unknown as Record<string, unknown>);
}

/**
 * Get outgoing friend request status. Local cache only — there is no
 * authoritative remote store in the P2P architecture.
 */
export async function getOutgoingRequestStatus(
  fromId: string,
  toId: string,
): Promise<"pending" | "accepted" | "none"> {
  void fromId;
  const local = await dbGet<FriendRequest>("settings", `friend-req-out-${toId}`);
  if (local && local.status === "pending") return "pending";
  if (local && local.status === "accepted") return "accepted";
  return "none";
}

// ─── Offline Message Buffer ─────────────────────────────────

export interface BufferedMessage {
  msg: P2PMessage;
  recipientId: string;
  storedAt: number;
}

export async function purgeExpiredBufferedMessages(userId: string): Promise<void> {
  void userId;
  const now = Date.now();
  const all = await dxdb.pending_messages.toArray();
  for (const rec of all) {
    const msg = rec.payload as unknown as P2PMessage;
    if (msg?.deleteAt && msg.deleteAt < now) {
      await dxdb.pending_messages.delete(rec.id);
    }
  }
}

export async function purgeExpiredBufferedMessagesForAllUsers(): Promise<number> {
  const now = Date.now();
  const all = await dxdb.pending_messages.toArray();
  let removed = 0;
  for (const rec of all) {
    const msg = rec.payload as unknown as P2PMessage;
    if (msg?.deleteAt && msg.deleteAt < now) {
      await dxdb.pending_messages.delete(rec.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Buffer a message locally for an offline recipient. The WebRTC engine drains
 * the queue automatically as soon as the peer comes online.
 */
export async function bufferMessageInCloud(recipientId: string, msg: P2PMessage): Promise<void> {
  await dxdb.pending_messages.put({
    id: msg.id,
    targetUserId: recipientId,
    senderUserId: msg.from,
    kind: "text_message",
    payload: {
      type: "text_message",
      ...msg,
      storedAt: Date.now(),
    } as unknown as Record<string, unknown>,
    blobFileId: msg.media?.fileId,
    createdAt: Date.now(),
    status: "queued",
  });
}

/**
 * Fetch messages buffered FOR this user. With no remote store the only place
 * messages can be waiting is the local pending queue (e.g. ones we never
 * managed to ship before reload). We return them for replay so the UI
 * mirrors what the recipient would see.
 */
export async function fetchBufferedMessages(userId: string): Promise<P2PMessage[]> {
  const all = await dxdb.pending_messages.where("targetUserId").equals(userId).toArray();
  const out: P2PMessage[] = [];
  for (const rec of all) {
    if (rec.kind !== "text_message") continue;
    const m = rec.payload as unknown as P2PMessage;
    if (!m || !m.id || !m.from) continue;
    if (isExpired(m.deleteAt)) continue;
    out.push({ ...m, status: "delivered" });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearBufferedMessages(userId: string, messageIds: string[]): Promise<void> {
  void userId;
  for (const id of messageIds) {
    await dxdb.pending_messages.delete(id);
  }
}

// ─── Message Status Updates ─────────────────────────────────

export async function updateMessageStatus(
  senderId: string,
  messageId: string,
  status: "delivered" | "read",
): Promise<void> {
  sendTrivoTextMessage({
    type: "message_status",
    id: `ms-${messageId}-${status}`,
    to: senderId,
    messageId,
    status,
    updatedAt: Date.now(),
  } as unknown as Record<string, unknown>);
}

export function listenForStatusUpdates(
  userId: string,
  onUpdate: (messageId: string, status: "delivered" | "read") => void,
): () => void {
  initTrivoServer(userId);
  const off = onTrivoMessage((data) => {
    if (!data || data.type !== "message_status") return;
    if (data.to && data.to !== userId) return;
    if (!data.messageId || (data.status !== "delivered" && data.status !== "read")) return;
    onUpdate(data.messageId, data.status);
  });
  return () => {
    try {
      off();
    } catch {}
  };
}

export async function clearStatusNotification(userId: string, messageId: string): Promise<void> {
  void userId;
  void messageId;
  // No remote receipts to clear in the pure-P2P model.
}

// ─── Startup Handshake ──────────────────────────────────────

/**
 * Startup handshake (no remote calls). Drains anything that was waiting in
 * the Dexie pending queue for this user (e.g. messages that landed in a
 * previous session but were never displayed), pushes them into the local
 * IndexedDB messages store, and updates chat metadata so the UI reflects
 * them on first paint.
 */
export async function performStartupHandshake(userId: string): Promise<P2PMessage[]> {
  console.log("[p2p-sync] startup handshake for", userId);
  initTrivoServer(userId);

  const buffered = await fetchBufferedMessages(userId);
  if (buffered.length === 0) return [];

  for (const msg of buffered) {
    (msg as P2PMessage).status = "delivered";
    await dbPut("messages", msg.id, msg);

    const existingMeta = await dbGet<ChatMeta>("contacts", msg.from);
    await dbPut("contacts", msg.from, {
      friendId: msg.from,
      friendName: existingMeta?.friendName || msg.from.substring(0, 8),
      friendAvatar: existingMeta?.friendAvatar || null,
      lastMessage: msg.text || "📎 Media",
      lastMessageTime: msg.timestamp,
      unread: (existingMeta?.unread || 0) + 1,
      started: true,
    } as ChatMeta);
  }

  await clearBufferedMessages(
    userId,
    buffered.map((m) => m.id),
  );

  return buffered;
}
