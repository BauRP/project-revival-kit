// ============================================================================
//  Messaging facade over the Tor onion engine.
//  Peers are addressed only by `.onion`. Messages live in Dexie `messages`;
//  the engine owns the sealed outbox and the DELIVERED_ACK lifecycle.
// ============================================================================

import { dbGet, dbGetAll, dbGetStrict, dbGetAllStrict, dbPut, dbPutStrict, dbClearStrict } from "./storage";
import { duplicateMessageMatches } from "./inbound-identity";
import { sanitizeRestoredOneTimeMessage } from "./one-time-policy";
import { deletedMessageKey, isDeletedMessageRecord, LOCAL_DELETED_CHAT_KEY, findUnreferencedMedia, redactLocalMessage, deletedLifecycleShell } from "./message-deletion-policy";
import { hasExpiredMessage } from "./message-retention";
import { dxdb, upsertContact, type StoredMessage } from "./dexie-db";
import { advanceDeliveryStatus } from "./delivery-status-policy";
import { mergeConversationRows } from "./conversation-index-policy";
import {
  onionEnsureConnection,
  onionIsConnectedTo,
  onionOnConnectionChange,
  onionOnDelivery,
  onionRegisterIncomingListener,
  onionSendDispatch,
} from "./onion-engine";
import { isValidOnion } from "./onion-id";
import { isLocalSupportPeer } from "./local-only-peer-policy";

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
    if (!isLocalSupportPeer(toOnion))
      throw new Error("Message not sent: recipient must have a valid Tor .onion address");
    await saveLocalMessage({ ...stored, status: "delivered" });
    return false;
  }
  // A scheduled retry after a successful ACK is not a new message.
  // Repeating its dispatch could deliver a second copy or resurrect a prior
  // one-time attachment. Recheck inside the transaction for consistency.
  let alreadyDelivered = false;
  await dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
    if (isDeletedMessageRecord((await dxdb.lifecycle.get(deletedMessageKey(stored.id)))?.data))
      throw new Error("This message was deleted locally and cannot be resent");
    const previous = await dxdb.messages.get(stored.id);
    if (!previous) {
      await dxdb.messages.add(stored as unknown as StoredMessage);
    } else if (!duplicateMessageMatches(previous, stored)) {
      throw new Error("Outbound message ID collision");
    } else if (previous.status === "delivered" || previous.status === "read") {
      alreadyDelivered = true;
    }
  });
  if (alreadyDelivered) return true;
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
  // Legacy/local-only callers must obey the same deletion tombstones as the
  // authenticated Tor ingress. A delayed save cannot resurrect erased data.
  await dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
    const erased = await dxdb.lifecycle.get(deletedMessageKey(msg.id));
    if (isDeletedMessageRecord(erased?.data))
      throw new Error("Cannot save a locally deleted message");
    const previous = await dxdb.messages.get(msg.id);
    const safe = previous
      ? { ...msg, status: advanceDeliveryStatus(previous.status, msg.status) }
      : msg;
    await dxdb.messages.put(safe as unknown as StoredMessage);
  });
}

/**
 * One transactional erase for chat clear, expiry and individual deletion.
 * Preserve shared attachments referenced by other messages. Keep the tiny
 * deletion tombstones so old Tor deliveries and restores cannot resurrect
 * user-removed messages.
 */
async function eraseLocalMessages(
  shouldRemove: (message: StoredMessage) => boolean,
  forceTombstoneIds: readonly string[] = [],
): Promise<number> {
  // Validate outside the write transaction, before mutating the database.
  for (const id of forceTombstoneIds) deletedMessageKey(id);
  const orphaned = await dxdb.transaction("rw", [
    dxdb.messages, dxdb.outbox, dxdb.lifecycle, dxdb.blobs, dxdb.partial_chunks,
  ], async () => {
    const all = await dxdb.messages.toArray();
    const removed = all.filter(shouldRemove);
    const ids = [...new Set([...removed.map((m) => m.id), ...forceTombstoneIds])];
    if (!ids.length) return { count: 0, fileIds: [] as string[] };
    const idSet = new Set(ids);
    const retained = all.filter((m) => !idSet.has(m.id));
    const orphanedFiles = findUnreferencedMedia(
      removed.map((m) => ({ media: m.media })),
      retained.map((m) => ({ media: m.media })),
    );
    const now = Date.now();
    for (const id of ids) {
      await dxdb.lifecycle.put({
        key: deletedMessageKey(id), chatKey: LOCAL_DELETED_CHAT_KEY,
        messageId: id, data: { deleted: true, deletedAt: now }, updatedAt: now,
      });
    }
    await dxdb.messages.bulkDelete(ids);
    // A canceled/expired outgoing dispatch must not be replayed on reconnect.
    await dxdb.outbox.bulkDelete(ids);
    const toDelete = await dxdb.lifecycle.where("messageId").anyOf(ids)
      .filter((r) => r.chatKey !== LOCAL_DELETED_CHAT_KEY &&
        r.chatKey !== "consumed-media").primaryKeys();
    if (toDelete.length) await dxdb.lifecycle.bulkDelete(toDelete);
    if (orphanedFiles.length) {
      await dxdb.blobs.bulkDelete(orphanedFiles);
      await dxdb.partial_chunks.where("fileId").anyOf(orphanedFiles).delete();
    }
    return { count: removed.length, fileIds: orphanedFiles };
  });
  if (orphaned.fileIds.length) {
    // Import lazily outside the Dexie transaction; revoke previews already
    // resolved into this WebView's memory.
    const { revokeStoredMediaUrls } = await import("./media-store");
    revokeStoredMediaUrls(orphaned.fileIds);
  }
  return orphaned.count;
}

/**
 * "Delete for me" keeps the tiny message shell for a placeholder but erases
 * text, caption, edit history, queued ciphertext and orphaned attachment data.
 * Local history protection blocks REMOTE edits, never this local deletion.
 */
export async function redactMessageForMe(
  selfId: string, peerId: string, messageId: string,
): Promise<void> {
  if (!selfId || !peerId) throw new Error("Missing local message participants");
  const { chatKey } = await import("./sync/message-lifecycle");
  const key = chatKey(selfId, peerId) + "::" + messageId.replace(/\//g, "_");
  const deletedKey = deletedMessageKey(messageId);
  const removedFiles = await dxdb.transaction("rw", [
    dxdb.messages, dxdb.lifecycle, dxdb.outbox, dxdb.blobs, dxdb.partial_chunks,
  ], async () => {
    const message = await dxdb.messages.get(messageId);
    const previous = await dxdb.lifecycle.get(key);
    const others = message ? await dxdb.messages.filter((m) => m.id !== messageId).toArray() : [];
    const unused = message ? findUnreferencedMedia(
      [{ media: message.media }], others.map((m) => ({ media: m.media })),
    ) : [];
    const now = Date.now();
    if (message) await dxdb.messages.put(redactLocalMessage(message));
    await dxdb.lifecycle.put({
      key, chatKey: chatKey(selfId, peerId), messageId: messageId.replace(/\//g, "_"),
      data: deletedLifecycleShell(previous?.data, messageId, selfId, now),
      updatedAt: now,
    });
    await dxdb.lifecycle.put({
      key: deletedKey, chatKey: LOCAL_DELETED_CHAT_KEY, messageId,
      data: { deleted: true, deletedAt: now }, updatedAt: now,
    });
    await dxdb.outbox.delete(messageId);
    // Delete-for-me is terminal: remove old per-message reactions and any
    // unshipped sealed reaction frames so later reconnection cannot replay
    // the user's reaction to a message they deliberately erased.
    const reactions = await dxdb.lifecycle.where("messageId").equals(messageId)
      .filter((row) => row.chatKey.startsWith("reaction::")).toArray();
    const outboundIds = reactions.map((row) => row.data.outboundEventId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (outboundIds.length) await dxdb.outbox.bulkDelete(outboundIds);
    if (reactions.length) await dxdb.lifecycle.bulkDelete(reactions.map((row) => row.key));
    if (unused.length) {
      await dxdb.blobs.bulkDelete(unused);
      await dxdb.partial_chunks.where("fileId").anyOf(unused).delete();
    }
    return unused;
  });
  if (removedFiles.length) {
    const { revokeStoredMediaUrls } = await import("./media-store");
    revokeStoredMediaUrls(removedFiles);
  }
}

export async function deleteLocalMessage(id: string): Promise<void> {
  // A user can delete a message before its delayed Tor delivery is persisted.
  // Always write the deletion tombstone and cancel its encrypted outbox entry
  // atomically, even when no message record exists yet.
  await eraseLocalMessages((m) => m.id === id, [id]);
}

export async function purgeExpiredLocalMessages(): Promise<number> {
  const now = Date.now();
  return eraseLocalMessages((m) => hasExpiredMessage(m.deleteAt, now));
}

export async function clearMessagesForChat(peer: string): Promise<void> {
  await eraseLocalMessages((m) => m.from === peer || m.to === peer);
}

export async function getMessagesForChat(peer: string): Promise<P2PMessage[]> {
  const now = Date.now();
  // Indexed from/to queries avoid scanning unrelated chats on every opening.
  // Keep one read transaction so a new message cannot slip between scans.
  const [sent, received] = await dxdb.transaction("r", dxdb.messages, () =>
    Promise.all([
      dxdb.messages.where("to").equals(peer).toArray(),
      dxdb.messages.where("from").equals(peer).toArray(),
    ]),
  );
  return mergeConversationRows(sent, received, now) as P2PMessage[];
}

/** One-time move of messages from the legacy key-value DB into Dexie. */
export async function migrateLegacyMessages(): Promise<void> {
  const migrated = await dbGetStrict<boolean>("settings", "messages-migrated-to-dexie");
  if (!migrated) {
    // A failed read must NOT be interpreted as an empty legacy database.
    const legacy = await dbGetAllStrict<P2PMessage>("messages");
    // Migration may be retried after a crash. Never replace a newer Dexie
    // message or its read/consumed state with an obsolete legacy copy.
    if (legacy.length) await dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
      const tombstones = await dxdb.lifecycle.where("chatKey").equals("consumed-media").toArray();
      const revoked = new Set(tombstones.filter((r) => r.data.consumed === true).map((r) => r.key));
      for (const msg of legacy) {
        if (typeof msg?.id !== "string" || !msg.id || msg.id.length > 128) continue;
        if (!(await dxdb.messages.get(msg.id)) &&
            !isDeletedMessageRecord((await dxdb.lifecycle.get(deletedMessageKey(msg.id)))?.data)) {
          await dxdb.messages.add(sanitizeRestoredOneTimeMessage(msg, revoked) as unknown as StoredMessage);
        }
      }
    });
    // Commit the migration marker BEFORE destroying the old records.
    await dbPutStrict("settings", "messages-migrated-to-dexie", true);
  }
  // Older releases set the marker but never wiped the original plaintext,
  // leaving recoverable copies even after "delete for me". Always retry the
  // cleanup after a crash; no current chat reads from this legacy table.
  await dbClearStrict("messages");
}

// ─── Chat metadata (display name → Dexie contacts) ───────────

export async function saveChatMeta(meta: ChatMeta): Promise<void> {
  // Chat metadata is user-visible state, not an optional debug cache.
  // A failed IndexedDB transaction must not be reported as a saved contact.
  await dbPutStrict("contacts", meta.friendId, meta);
  if (isValidOnion(meta.friendId)) await upsertContact(meta.friendId, meta.friendName);
}

export async function getChatMeta(friendId: string): Promise<ChatMeta | undefined> {
  return dbGetStrict<ChatMeta>("contacts", friendId);
}

export async function getAllChatMetas(): Promise<ChatMeta[]> {
  return dbGetAllStrict<ChatMeta>("contacts");
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
