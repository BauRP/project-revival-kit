import { dbGet, dbPut, dbUpdateStrict } from "@/lib/storage";

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

function preferenceKey(chatId: string): string {
  if (typeof chatId !== "string" || !chatId ||
      chatId.length > 128 || /[\u0000-\u001f\u007f]/.test(chatId))
    throw new Error("Invalid chat identity for preferences");
  return KEY_PREFIX + chatId;
}

const durationToMs: Record<Exclude<DisappearingDuration, "off">, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/** Never treat a corrupt blocked/mute/expiry preference as an intentional
 * permission change. Unknown legacy fields remain preserved for compatibility.
 */
export function validateChatPreferenceState(value: unknown): ChatPreferenceState {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid chat preferences");
  const row = value as Record<string, unknown>;
  for (const field of ["blocked", "favorite", "archived", "silentDefault", "oneTimeDefault"]) {
    if (row[field] !== undefined && typeof row[field] !== "boolean")
      throw new Error("Invalid chat preference: " + field);
  }
  const muted = row.mutedUntil;
  if (muted !== undefined && muted !== null &&
      (typeof muted !== "number" || !Number.isSafeInteger(muted) || muted < 0))
    throw new Error("Invalid chat mute deadline");
  const duration = row.disappearingDuration;
  if (duration !== undefined && !["off", "1h", "6h", "12h", "24h"].includes(duration as string))
    throw new Error("Invalid disappearing message duration");
  return value as ChatPreferenceState;
}

export async function getChatPreferences(chatId: string): Promise<ChatPreferenceState> {
  return validateChatPreferenceState(await dbGet<unknown>("settings", preferenceKey(chatId)));
}

export async function saveChatPreferences(
  chatId: string,
  next: ChatPreferenceState,
): Promise<void> {
  await dbPut("settings", preferenceKey(chatId), validateChatPreferenceState(next));
}

export async function updateChatPreferences(
  chatId: string,
  patch: Partial<ChatPreferenceState>,
): Promise<ChatPreferenceState> {
  validateChatPreferenceState(patch);
  return dbUpdateStrict<ChatPreferenceState>(
    "settings", preferenceKey(chatId),
    (current) => validateChatPreferenceState({
      ...validateChatPreferenceState(current), ...patch,
    }),
  );
}

export function getDeleteAt(timestamp: number, duration: DisappearingDuration): number | undefined {
  // A corrupt duration used to become NaN, silently preventing messages
  // from expiring. Refuse invalid data without deleting any user history.
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new Error("Invalid disappearing message timestamp");
  if (duration === "off") return undefined;
  const offset = durationToMs[duration];
  if (!Number.isSafeInteger(offset) || offset <= 0 ||
      !Number.isSafeInteger(timestamp + offset))
    throw new Error("Invalid disappearing message duration");
  return timestamp + offset;
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
