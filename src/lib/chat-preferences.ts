import { dbGet, dbPut } from "@/lib/storage";

export type DisappearingDuration = "1h" | "6h" | "12h" | "24h" | "off";

export interface ChatPreferenceState {
  mutedUntil?: number | null;
  blocked?: boolean;
  favorite?: boolean;
  /** Phase 2 §1 — chat is hidden in the Archive folder (revealed via overscroll). */
  archived?: boolean;
  disappearingDuration?: DisappearingDuration;
  /** Default Silent send for new outgoing messages in this chat. */
  silentDefault?: boolean;
  /** Default One-Time view flag for next attachment in this chat. */
  oneTimeDefault?: boolean;
}

const KEY_PREFIX = "chat-preferences-";

const durationToMs: Record<Exclude<DisappearingDuration, "off">, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

export async function getChatPreferences(chatId: string): Promise<ChatPreferenceState> {
  return (await dbGet<ChatPreferenceState>("settings", `${KEY_PREFIX}${chatId}`)) || {};
}

export async function saveChatPreferences(chatId: string, next: ChatPreferenceState): Promise<void> {
  await dbPut("settings", `${KEY_PREFIX}${chatId}`, next);
}

export async function updateChatPreferences(chatId: string, patch: Partial<ChatPreferenceState>): Promise<ChatPreferenceState> {
  const current = await getChatPreferences(chatId);
  const next = { ...current, ...patch };
  await saveChatPreferences(chatId, next);
  return next;
}

export function getDeleteAt(timestamp: number, duration: DisappearingDuration): number | undefined {
  if (duration === "off") return undefined;
  return timestamp + durationToMs[duration];
}

export function isExpired(deleteAt?: number): boolean {
  return typeof deleteAt === "number" && deleteAt <= Date.now();
}

/** Sentinel for "mute forever" — far enough in the future to never elapse. */
export const MUTE_FOREVER = 8640000000000000 - 1;

export function getMuteUntil(duration: DisappearingDuration | "always"): number | null {
  if (duration === "always") return MUTE_FOREVER;
  if (duration === "off") return null;
  return getDeleteAt(Date.now(), duration) ?? null;
}

/** True when the stored mute deadline is still in the future. */
export function isMuted(mutedUntil?: number | null): boolean {
  return typeof mutedUntil === "number" && mutedUntil > Date.now();
}