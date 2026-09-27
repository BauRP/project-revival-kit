import { dbGet, dbPut } from "@/lib/storage";

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
