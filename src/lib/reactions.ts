import { dbGet } from "@/lib/storage";
import { dxdb, type LifecycleRecord } from "./dexie-db";
import { onionRegisterIncomingListener, onionSendDispatch, ensureLocalIdentity } from "./onion-engine";
import { isValidOnion } from "./onion-id";

/** Reactions are durable Dexie records, with tombstones for removals. */
export type ReactionMap = Record<string, Record<string, string>>;
const legacyKey = (chatId: string) => `reactions-${chatId}`;
const reactionChatKey = (peer: string) => `reaction::${peer}`;
export const reactionRecordKey = (peer: string, message: string, reactor: string) =>
  JSON.stringify(["reaction", peer, message, reactor]);

/** Rebuild the visible map from durable records (including older local data). */
export async function getReactions(chatId: string): Promise<ReactionMap> {
  const old = (await dbGet<ReactionMap>("settings", legacyKey(chatId))) || {};
  const map: ReactionMap = Object.fromEntries(
    Object.entries(old).map(([messageId, actors]) => [messageId, { ...actors }]),
  );
  const rows = await dxdb.lifecycle.where("chatKey").equals(reactionChatKey(chatId)).toArray();
  for (const row of rows) {
    const actor = String(row.data.reactorId || "");
    const emoji = row.data.emoji;
    if (!actor || !row.messageId) continue;
    const actors = { ...(map[row.messageId] || {}) };
    if (typeof emoji === "string" && emoji.length > 0) actors[actor] = emoji;
    else delete actors[actor]; // durable removal overrides legacy value
    map[row.messageId] = actors;
  }
  return map;
}

/** Monotonic local/remote timestamp to preserve rapid successive reaction changes. */
export function nextReactionUpdatedAt(previous: number, now: number): number {
  return Math.max(now, previous + 1);
}

/** Local user action; serialize read/modify/write inside one transaction. */
export async function toggleReaction(
  chatId: string, messageId: string, reactorId: string, emoji: string,
): Promise<ReactionMap> {
  if (!messageId || !reactorId || !emoji || emoji.length > 24)
    throw new Error("Invalid reaction");
  const legacy = await dbGet<ReactionMap>("settings", legacyKey(chatId));
  await dxdb.transaction("rw", dxdb.lifecycle, async () => {
    const key = reactionRecordKey(chatId, messageId, reactorId);
    const previous = await dxdb.lifecycle.get(key);
    const oldEmoji = previous ? previous.data.emoji : legacy?.[messageId]?.[reactorId];
    const nextEmoji = oldEmoji === emoji ? null : emoji;
    const updatedAt = nextReactionUpdatedAt(previous?.updatedAt || 0, Date.now());
    const record: LifecycleRecord = {
      key, chatKey: reactionChatKey(chatId), messageId,
      data: { reactorId, emoji: nextEmoji }, updatedAt,
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

export function broadcastReaction(peer: string, messageId: string, _emoji: string | null): void {
  if (!isValidOnion(peer)) return;
  // Read the committed state, not the possibly stale UI callback arguments.
  // A slower earlier callback can never overwrite the newest toggle remotely.
  void (async () => {
    const self = await ensureLocalIdentity();
    const stored = await dxdb.lifecycle.get(reactionRecordKey(peer, messageId, self));
    if (!stored) return;
    const emoji = stored.data.emoji;
    if (emoji !== null && (typeof emoji !== "string" || emoji.length > 24)) return;
    await onionSendDispatch(peer, {
      type: "message_reaction",
      id: crypto.randomUUID(),
      messageId,
      emoji,
      updatedAt: stored.updatedAt,
    });
  })().catch((error) => console.warn("[reactions] durable sync failed", error));
}

export function aggregate(
  forMsg: Record<string, string> | undefined,
): Array<{ emoji: string; count: number }> {
  if (!forMsg) return [];
  const counts: Record<string, number> = {};
  for (const emoji of Object.values(forMsg)) counts[emoji] = (counts[emoji] || 0) + 1;
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
}
