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

async function readLocalMap(
  chatA: string,
  chatB: string,
): Promise<Record<string, MessageLifecycle>> {
  const stored = await getLifecycleMap(chatKey(chatA, chatB));
  const out: Record<string, MessageLifecycle> = {};
  for (const [mid, raw] of Object.entries(stored)) {
    out[mid] = {
      messageId: mid,
      ...(raw as object),
    } as MessageLifecycle;
  }
  return out;
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
  await dxdb.transaction("rw", dxdb.lifecycle, async () => {
    const previous = await dxdb.lifecycle.get(key);
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
  const patch: Partial<MessageLifecycle> = {
    deletedForEveryone: true,
    isEdited: false,
    editedText: undefined,
  };
  // Durable encrypted outbox first. If sealing/storage fails, the UI must
  // not claim the remote mutation succeeded in the local mirror.
  await broadcastLifecycle(selfId, peerId, messageId, patch);
  await writeLocalEntry(selfId, peerId, messageId, patch);
}

export async function pinMessage(selfId: string, peerId: string, messageId: string): Promise<void> {
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

  readLocalMap(selfId, peerId)
    .then((m) => {
      if (!cancelled) onUpdate(m);
    })
    .catch(() => {});

  // The engine commits inbound lifecycle patches to Dexie before notifying.
  const off = onionRegisterIncomingListener((data) => {
    if (cancelled || data.type !== "message_lifecycle" || data.chatKey !== key) return;
    readLocalMap(selfId, peerId)
      .then((m) => {
        if (!cancelled) onUpdate(m);
      })
      .catch(() => {});
  });

  return () => {
    cancelled = true;
    off();
  };
}
