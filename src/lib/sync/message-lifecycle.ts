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
import { getLifecycleMap, putLifecycle } from "../dexie-db";
import { assertRemoteHistoryAllowsChanges } from "../history-protection";

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
  const map = await readLocalMap(chatA, chatB);
  const prev = map[safeId] || { messageId: safeId };
  const next: MessageLifecycle = {
    ...prev,
    ...patch,
    messageId: safeId,
    updatedAt: Date.now(),
  };
  await putLifecycle(ck, safeId, next as unknown as Record<string, unknown>);
}

function broadcastLifecycle(
  selfId: string,
  peerId: string,
  messageId: string,
  patch: Partial<MessageLifecycle>,
): void {
  if (!isValidOnion(peerId)) return; // local-only chats (support bot)
  void onionSendDispatch(peerId, {
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
  await writeLocalEntry(selfId, peerId, messageId, patch);
  broadcastLifecycle(selfId, peerId, messageId, patch);
}

export async function deleteMessageForMe(
  selfId: string,
  peerId: string,
  messageId: string,
): Promise<void> {
  const safeId = messageId.replace(/\//g, "_");
  const map = await readLocalMap(selfId, peerId);
  const prev = map[safeId] || { messageId: safeId };
  const list = new Set<string>(prev.deletedFor || []);
  list.add(selfId);
  await writeLocalEntry(selfId, peerId, messageId, { deletedFor: Array.from(list) });
  // Local-only — no broadcast.
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
  await writeLocalEntry(selfId, peerId, messageId, patch);
  broadcastLifecycle(selfId, peerId, messageId, patch);
}

export async function pinMessage(selfId: string, peerId: string, messageId: string): Promise<void> {
  const patch: Partial<MessageLifecycle> = { pinnedAt: Date.now(), pinnedBy: selfId };
  await writeLocalEntry(selfId, peerId, messageId, patch);
  broadcastLifecycle(selfId, peerId, messageId, patch);
}

export async function unpinMessage(
  selfId: string,
  peerId: string,
  messageId: string,
): Promise<void> {
  const patch: Partial<MessageLifecycle> = { pinnedAt: undefined, pinnedBy: undefined };
  await writeLocalEntry(selfId, peerId, messageId, patch);
  broadcastLifecycle(selfId, peerId, messageId, {
    ...patch,
    clearPin: true,
  } as unknown as Partial<MessageLifecycle>);
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
