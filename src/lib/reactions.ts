import { dbGet } from "@/lib/storage";
import { dxdb, type LifecycleRecord } from "./dexie-db";
import { onionRegisterIncomingListener, onionSendDispatch, ensureLocalIdentity } from "./onion-engine";
import { isValidOnion } from "./onion-id";
import { deletedMessageKey, isDeletedMessageRecord } from "./message-deletion-policy";
import { canReactToVisibleMessage, pruneDeletedReactionMap } from "./reaction-deletion-policy";
import { normalizeLegacyReactions } from "./reaction-policy";

/** Reactions are durable Dexie records, with tombstones for removals. */
export type ReactionMap = Record<string, Record<string, string>>;
const legacyKey = (chatId: string) => `reactions-${chatId}`;
const reactionChatKey = (peer: string) => `reaction::${peer}`;
export const reactionRecordKey = (peer: string, message: string, reactor: string) =>
  JSON.stringify(["reaction", peer, message, reactor]);

/** Rebuild the visible map from durable records (including older local data). */
export async function getReactions(chatId: string): Promise<ReactionMap> {
  const old = await dbGet<unknown>("settings", legacyKey(chatId));
  const map = normalizeLegacyReactions(old);
  const rows = await dxdb.lifecycle.where("chatKey").equals(reactionChatKey(chatId)).toArray();
  for (const row of rows) {
    const actor = row.data?.reactorId;
    const emoji = row.data?.emoji;
    if (typeof actor !== "string" || !actor || actor.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(actor) || !row.messageId ||
        row.key !== reactionRecordKey(chatId, row.messageId, actor)) continue;
    const actors = map[row.messageId] ?? Object.create(null) as Record<string, string>;
    if (typeof emoji === "string" && emoji.length > 0 && emoji.length <= 24) {
      actors[actor] = emoji;
    } else if (emoji === null) {
      delete actors[actor];
    } else continue;
    map[row.messageId] = actors;
  }
  const ids = Object.keys(map);
  if (!ids.length) return map;
  const tombstones = await dxdb.lifecycle.bulkGet(ids.map(deletedMessageKey));
  const deleted = new Set(ids.filter((id, i) =>
    isDeletedMessageRecord(tombstones[i]?.data)));
  return deleted.size ? pruneDeletedReactionMap(map, deleted) : map;
}

/** Monotonic local/remote timestamp to preserve rapid successive reaction changes. */
export function nextReactionUpdatedAt(previous: number, now: number): number {
  return Math.max(now, previous + 1);
}

/** Local user action; serialize read/modify/write inside one transaction. */
export async function toggleReaction(
  chatId: string, messageId: string, reactorId: string, emoji: string,
): Promise<ReactionMap> {
  if (typeof messageId !== "string" || !messageId ||
      typeof reactorId !== "string" || !reactorId ||
      typeof emoji !== "string" || !emoji || emoji.length > 24)
    throw new Error("Invalid reaction");
  const legacy = normalizeLegacyReactions(await dbGet<unknown>("settings", legacyKey(chatId)));
  await dxdb.transaction("rw", [dxdb.messages, dxdb.lifecycle], async () => {
    // A deleted message stays deleted even when the UI still displays its
    // redacted placeholder or an event races the user's Delete action.
    const stored = await dxdb.messages.get(messageId);
    const erased = await dxdb.lifecycle.get(deletedMessageKey(messageId));
    if (!canReactToVisibleMessage(stored, chatId, reactorId, erased?.data))
      throw new Error("Cannot react to a deleted or unrelated message");
    const key = reactionRecordKey(chatId, messageId, reactorId);
    const previous = await dxdb.lifecycle.get(key);
    const oldEmoji = previous ? previous.data.emoji : legacy?.[messageId]?.[reactorId];
    const nextEmoji = oldEmoji === emoji ? null : emoji;
    const updatedAt = nextReactionUpdatedAt(previous?.updatedAt || 0, Date.now());
    const record: LifecycleRecord = {
      key, chatKey: reactionChatKey(chatId), messageId,
      // Before the encrypted Tor outbox accepts this event, keep a durable
      // recovery marker. Each toggle has a unique immutable dispatch ID.
      data: { reactorId, emoji: nextEmoji, outboundEventId: crypto.randomUUID(),
        outboundPending: isValidOnion(chatId) }, updatedAt,
    };
    await dxdb.lifecycle.put(record);
  });
  return getReactions(chatId);
}

/** Display listeners fire AFTER the authenticated inbound Dexie commit. */
const listeners = new Set<(peer: string, map: ReactionMap) => void>();
export function subscribeReactions(chatId: string, cb: (map: ReactionMap) => void): () => void {
  const listener = (peer: string, map: ReactionMap) => { if (peer === chatId) cb(map); };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

onionRegisterIncomingListener((payload) => {
  if (payload.type !== "message_reaction") return;
  const peer = String(payload.from || "");
  if (!isValidOnion(peer)) return;
  void getReactions(peer).then((map) => {
    listeners.forEach((cb) => cb(peer, map));
  }).catch((error) => console.warn("[reactions] unable to update UI", error));
});

/** A stale completion must never clear the pending flag of a newer toggle. */
export function isSameReactionDispatch(
  current: Record<string, unknown> | undefined,
  expectedId: string,
): boolean {
  return current?.outboundEventId === expectedId &&
    current.outboundPending === true;
}

async function persistReactionToOutbox(peer: string, messageId: string, self: string): Promise<void> {
  if (!isValidOnion(peer)) return;
  const key = reactionRecordKey(peer, messageId, self);
  const stored = await dxdb.lifecycle.get(key);
  if (!stored) return;
  const [message, erased] = await Promise.all([
    dxdb.messages.get(messageId),
    dxdb.lifecycle.get(deletedMessageKey(messageId)),
  ]);
  if (!canReactToVisibleMessage(message, peer, self, erased?.data)) return;
  const emoji = stored.data.emoji;
  if (emoji !== null && (typeof emoji !== "string" || emoji.length > 24)) return;
  const eventId = typeof stored.data.outboundEventId === "string"
    ? stored.data.outboundEventId : crypto.randomUUID();
  // A false result means Tor delivery is pending, not that the durable
  // encrypted outbox failed. Only rejected writes leave the marker intact.
  await onionSendDispatch(peer, {
    type: "message_reaction", id: eventId,
    messageId, emoji, updatedAt: stored.updatedAt,
  });
  await dxdb.transaction("rw", dxdb.lifecycle, async () => {
    const current = await dxdb.lifecycle.get(key);
    if (!current || !isSameReactionDispatch(current.data, eventId)) return;
    await dxdb.lifecycle.put({
      ...current,
      data: { ...current.data, outboundPending: false },
    });
  });
}

export function broadcastReaction(peer: string, messageId: string, _emoji: string | null): void {
  if (!isValidOnion(peer)) return;
  void ensureLocalIdentity().then((self) =>
    persistReactionToOutbox(peer, messageId, self))
    .catch((error) => console.warn("[reactions] encrypted dispatch failed; will retry", error));
}

/** Recover reactions committed immediately before WebView death or a crash. */
export async function recoverPendingReactionSync(): Promise<number> {
  const self = await ensureLocalIdentity();
  const rows = await dxdb.lifecycle.where("chatKey").startsWith("reaction::")
    .filter((row) => row.data?.reactorId === self && row.data?.outboundPending === true)
    .toArray();
  let recovered = 0;
  for (const row of rows) {
    if (row.data.reactorId !== self || row.data.outboundPending !== true ||
        !row.chatKey.startsWith("reaction::")) continue;
    const peer = row.chatKey.slice("reaction::".length);
    if (!isValidOnion(peer)) continue;
    try {
      await persistReactionToOutbox(peer, row.messageId, self);
      recovered++;
    } catch (error) {
      console.warn("[reactions] pending reaction retained for later recovery", error);
    }
  }
  return recovered;
}

export function aggregate(
  forMsg: Record<string, string> | undefined,
): Array<{ emoji: string; count: number }> {
  if (!forMsg) return [];
  const counts = new Map<string, number>();
  for (const emoji of Object.values(forMsg)) {
    if (typeof emoji !== "string" || !emoji || emoji.length > 24) continue;
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }
  return [...counts].map(([emoji, count]) => ({ emoji, count }));
}

export { shouldApplyRemoteReaction } from "./reaction-policy";
