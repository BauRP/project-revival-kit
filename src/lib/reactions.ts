import { dbGet, dbPut } from "@/lib/storage";
import { onionRegisterIncomingListener, onionSendDispatch } from "./onion-engine";
import { isValidOnion } from "./onion-id";

/**
 * Phase 2 §5 — Local reaction store.
 *
 * Reactions are stored per chat as a map of messageId → reactor → emoji. We
 * keep this client-only for now to avoid a schema migration; a future
 * P2P round-trip can hydrate these maps into the messages table.
 */

export type ReactionMap = Record<string, Record<string, string>>;

const KEY = (chatId: string) => `reactions-${chatId}`;

export async function getReactions(chatId: string): Promise<ReactionMap> {
  return (await dbGet<ReactionMap>("settings", KEY(chatId))) || {};
}

export async function toggleReaction(
  chatId: string,
  messageId: string,
  reactorId: string,
  emoji: string,
): Promise<ReactionMap> {
  const map = await getReactions(chatId);
  const forMsg = { ...(map[messageId] || {}) };
  if (forMsg[reactorId] === emoji) {
    delete forMsg[reactorId];
  } else {
    forMsg[reactorId] = emoji;
  }
  const next: ReactionMap = { ...map, [messageId]: forMsg };
  await dbPut("settings", KEY(chatId), next);
  return next;
}

/** Aggregate reactions for one message into [{emoji, count}] for rendering. */
export function aggregate(
  forMsg: Record<string, string> | undefined,
): Array<{ emoji: string; count: number }> {
  if (!forMsg) return [];
  const counts: Record<string, number> = {};
  for (const emoji of Object.values(forMsg)) {
    counts[emoji] = (counts[emoji] || 0) + 1;
  }
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
}

/** Apply one authenticated peer's state; removal is an explicit tombstone. */
export async function applyRemoteReaction(chatId: string, messageId: string, reactorId: string, emoji: string | null): Promise<ReactionMap> {
  const map = await getReactions(chatId);
  const current = { ...(map[messageId] || {}) };
  if (emoji) current[reactorId] = emoji;
  else delete current[reactorId];
  const next = { ...map, [messageId]: current };
  await dbPut("settings", KEY(chatId), next);
  return next;
}

const reactionListeners = new Set<(chatId: string, map: ReactionMap) => void>();
export function subscribeReactions(chatId: string, cb: (map: ReactionMap) => void): () => void {
  const listener = (peer: string, map: ReactionMap) => { if (peer === chatId) cb(map); };
  reactionListeners.add(listener);
  return () => reactionListeners.delete(listener);
}

onionRegisterIncomingListener((payload) => {
  if (payload.type !== "message_reaction") return;
  const peer = String(payload.from || "");
  const messageId = String(payload.messageId || "");
  const emoji = payload.emoji === null ? null : String(payload.emoji || "");
  if (!isValidOnion(peer) || !messageId || (emoji !== null && emoji.length > 24)) return;
  void applyRemoteReaction(peer, messageId, peer, emoji).then((map) => {
    reactionListeners.forEach((cb) => cb(peer, map));
  });
});

export function broadcastReaction(peer: string, messageId: string, emoji: string | null): void {
  if (!isValidOnion(peer)) return;
  void onionSendDispatch(peer, {
    type: "message_reaction", id: crypto.randomUUID(), messageId, emoji,
    updatedAt: Date.now(),
  }).catch((e) => console.warn("[reactions] send queued/failed", e));
}
