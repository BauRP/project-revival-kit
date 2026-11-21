// ============================================================================
//  Trivo Chat Elite — message lifecycle (edit / delete / pin), pure P2P
//  ---------------------------------------------------------------------------
//  Every remote HTTP call has been removed. Lifecycle mutations are now
//  sent through the sealed Tor outbox and mirrored to Dexie so the
//  UI works offline and across reloads. Public API preserved 1:1:
//  editMessage, deleteMessageForMe, deleteMessageForEveryone, pinMessage,
//  unpinMessage, subscribeLifecycle, chatKey, MessageLifecycle.
// ============================================================================

import { onionRegisterIncomingListener, onionSendDispatch } from "../onion-engine";
import { isValidOnion } from "../onion-id";
import { dxdb, getLifecycleMap } from "../dexie-db";
import { assertRemoteHistoryAllowsChanges } from "../history-protection";
import { redactMessageForMe } from "../p2p";
import { canAuthorModifyOwnMessage, mayPinChatMessage, mayCommitLocalLifecycle } from "../lifecycle-auth";
import { deletedMessageKey } from "../message-deletion-policy";

export interface MessageLifecycle {
  messageId: string;
  isEdited?: boolean;
  editedText?: string;
  deletedForEveryone?: boolean;
  deletedFor?: string[];
  pinnedAt?: number;
  pinnedBy?: string;
  updatedAt?: number;
}

export function chatKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}

// ─── Local mirror ───────────────────────────────────────────

/**
 * Only the indexed lifecycle message ID is authoritative. An old/corrupt
 * payload must not override it or mutate the prototype of the UI map.
 */
export function safeLifecycleMap(
  stored: Record<string, Record<string, unknown>>,
): Record<string, MessageLifecycle> {
  const out: Record<string, MessageLifecycle> = Object.create(null);
  for (const [id, raw] of Object.entries(stored)) {
    if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id) ||
        !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry: MessageLifecycle = { messageId: id };
    if (typeof raw.isEdited === "boolean") entry.isEdited = raw.isEdited;
    if (typeof raw.editedText === "string" && raw.editedText.length <= 200_000)
      entry.editedText = raw.editedText;
    if (typeof raw.deletedForEveryone === "boolean")
      entry.deletedForEveryone = raw.deletedForEveryone;
    if (Array.isArray(raw.deletedFor) &&
        raw.deletedFor.length <= 128 && raw.deletedFor.every(
          (v) => typeof v === "string" && v.length <= 128))
      entry.deletedFor = raw.deletedFor;
    if (Number.isSafeInteger(raw.pinnedAt) && (raw.pinnedAt as number) >= 0)
      entry.pinnedAt = raw.pinnedAt as number;
    if (typeof raw.pinnedBy === "string" && raw.pinnedBy.length <= 128)
      entry.pinnedBy = raw.pinnedBy;
    if (Number.isSafeInteger(raw.updatedAt) && (raw.updatedAt as number) > 0)
      entry.updatedAt = raw.updatedAt as number;
    Object.defineProperty(out, id, {
      value: entry, enumerable: true, configurable: true, writable: true,
    });
  }
  return out;
}

async function readLocalMap(
  chatA: string,
  chatB: string,
): Promise<Record<string, MessageLifecycle>> {
  const stored = await getLifecycleMap(chatKey(chatA, chatB));
  return safeLifecycleMap(stored);
}

async function writeLocalEntry(
  chatA: string,
  chatB: string,
  messageId: string,
  patch: Partial<MessageLifecycle>,
): Promise<void> {
  const safeId = messageId.replace(/\//g, "_");
  const ck = chatKey(chatA, chatB);
  const key = `${ck}::${safeId}`;
  // Serialize concurrent edits/pins to this one record. Reading the whole
  // conversation outside a transaction previously lost unrelated changes.
  await dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
    const [message, deleted, previous] = await Promise.all([
      dxdb.messages.get(messageId),
      dxdb.lifecycle.get(deletedMessageKey(messageId)),
      dxdb.lifecycle.get(key),
    ]);
    if (!mayCommitLocalLifecycle(message, chatA, chatB,
        patch as Record<string, unknown>, deleted))
      throw new Error("Message was deleted or changed before local history commit");
    const prev = previous?.data || { messageId: safeId };
    const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    await dxdb.lifecycle.put({
      key, chatKey: ck, messageId: safeId,
      data: { ...prev, ...patch, messageId: safeId, updatedAt: now },
      updatedAt: now,
    });
  });
}

async function broadcastLifecycle(
  selfId: string,
  peerId: string,
  messageId: string,
  patch: Partial<MessageLifecycle>,
): Promise<void> {
  if (!isValidOnion(peerId)) return; // local-only chats (support bot)
  await onionSendDispatch(peerId, {
    type: "message_lifecycle",
    id: `lc-${crypto.randomUUID()}`,
    chatKey: chatKey(selfId, peerId),
    messageId: messageId.replace(/\//g, "_"),
    patch,
    updatedAt: Date.now(),
  });
}

// ─── Mutations ──────────────────────────────────────────────

export async function editMessage(
  selfId: string,
  peerId: string,
  messageId: string,
  newText: string,
): Promise<void> {
  await assertRemoteHistoryAllowsChanges(peerId);
  const original = await dxdb.messages.get(messageId);
  if (!canAuthorModifyOwnMessage(original, selfId, peerId))
    throw new Error("Only the original author can edit this message");
  if (!newText || newText.length > 200_000)
    throw new Error("Edited message text is missing or too long");
  const patch: Partial<MessageLifecycle> = { isEdited: true, editedText: newText };
  // Durable encrypted outbox first. If sealing/storage fails, the UI must
  // not claim the remote mutation succeeded in the local mirror.
  await broadcastLifecycle(selfId, peerId, messageId, patch);
  await writeLocalEntry(selfId, peerId, messageId, patch);
}

export async function deleteMessageForMe(
  selfId: string,
  peerId: string,
  messageId: string,
): Promise<void> {
  // One crash-safe transaction scrubs plaintext, cancels a pending send,
  // marks the ID deleted, and retains only the UI placeholder metadata.
  // Local-only action: never sent to the other participant.
  await redactMessageForMe(selfId, peerId, messageId);
}

export async function deleteMessageForEveryone(
  selfId: string,
  peerId: string,
  messageId: string,
): Promise<void> {
  await assertRemoteHistoryAllowsChanges(peerId);
  const original = await dxdb.messages.get(messageId);
  if (!canAuthorModifyOwnMessage(original, selfId, peerId))
    throw new Error("Only the original author can delete this message for everyone");
  const patch: Partial<MessageLifecycle> = {
    deletedForEveryone: true,
    isEdited: false,
    editedText: undefined,
  };
  // Durable encrypted outbox first. If sealing/storage fails, the UI must
  // not claim the remote mutation succeeded in the local mirror.
  await broadcastLifecycle(selfId, peerId, messageId, patch);
  // Erase the sender's own plaintext and unsent old message frame as well.
  // The deletion event has an independent lc-* ID, so it stays in the sealed
  // Tor outbox until the other participant acknowledges it.
  await redactMessageForMe(selfId, peerId, messageId);
  await writeLocalEntry(selfId, peerId, messageId, patch);
}

async function assertPinTarget(selfId: string, peerId: string, messageId: string): Promise<void> {
  const allowed = await dxdb.transaction("r", [dxdb.messages, dxdb.lifecycle], async () => {
    const [message, deleted] = await Promise.all([
      dxdb.messages.get(messageId),
      dxdb.lifecycle.get(deletedMessageKey(messageId)),
    ]);
    return mayPinChatMessage(message, selfId, peerId, deleted?.data);
  });
  if (!allowed) throw new Error("Cannot pin a deleted or unrelated message");
}

export async function pinMessage(selfId: string, peerId: string, messageId: string): Promise<void> {
  await assertPinTarget(selfId, peerId, messageId);
  const patch: Partial<MessageLifecycle> = { pinnedAt: Date.now(), pinnedBy: selfId };
  // Durable encrypted outbox first. If sealing/storage fails, the UI must
  // not claim the remote mutation succeeded in the local mirror.
  await broadcastLifecycle(selfId, peerId, messageId, patch);
  await writeLocalEntry(selfId, peerId, messageId, patch);
}

export async function unpinMessage(
  selfId: string,
  peerId: string,
  messageId: string,
): Promise<void> {
  await assertPinTarget(selfId, peerId, messageId);
  const patch: Partial<MessageLifecycle> = { pinnedAt: undefined, pinnedBy: undefined };
  await broadcastLifecycle(selfId, peerId, messageId, {
    ...patch,
    clearPin: true,
  } as unknown as Partial<MessageLifecycle>);
  await writeLocalEntry(selfId, peerId, messageId, patch);
}

// ─── Subscription ───────────────────────────────────────────

export function subscribeLifecycle(
  selfId: string,
  peerId: string,
  onUpdate: (map: Record<string, MessageLifecycle>) => void,
): () => void {
  const key = chatKey(selfId, peerId);
  let cancelled = false;
  let revision = 0;
  const refresh = () => {
    const request = ++revision;
    void readLocalMap(selfId, peerId)
      .then((map) => {
        // A slower, older read must not overwrite a later Tor update.
        if (!cancelled && request === revision) onUpdate(map);
      })
      .catch((error) => {
        if (!cancelled && request === revision)
          console.warn("[lifecycle] unable to refresh chat history", error);
      });
  };

  refresh();
  // The engine commits inbound lifecycle patches to Dexie before notifying.
  const off = onionRegisterIncomingListener((data) => {
    if (cancelled || data.type !== "message_lifecycle" || data.chatKey !== key) return;
    refresh();
  });

  return () => {
    cancelled = true;
    off();
  };
}
