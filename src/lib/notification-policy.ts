/** Pure, offline-only notification delivery policy. */
export interface NotificationPolicyInput {
  enabled: boolean;
  mutedUntil?: number | null;
  blocked?: boolean;
  silent?: boolean;
}
export function shouldNotifyChat(input: NotificationPolicyInput, now: number = Date.now()): boolean {
  if (input.enabled !== true || !Number.isSafeInteger(now) || now < 0) return false;
  // Corrupted persisted preferences must not silently unmute a private chat.
  // Only absence (undefined) is the legacy default; malformed values fail closed.
  if (input.blocked !== undefined && typeof input.blocked !== "boolean") return false;
  if (input.silent !== undefined && typeof input.silent !== "boolean") return false;
  if (input.mutedUntil !== undefined && input.mutedUntil !== null &&
      (!Number.isSafeInteger(input.mutedUntil) || input.mutedUntil < 0)) return false;
  return input.blocked !== true && input.silent !== true &&
    !(typeof input.mutedUntil === "number" && input.mutedUntil > now);
}
/** Only visible Unicode text is allowed into system notifications. */
function visibleText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || fallback;
}
export function safeNotificationText(
  title: unknown, body: unknown, hideContent: unknown,
): { title: string; body: string } {
  // Only an explicit user preference false permits previews. Invalid or
  // missing privacy settings must not expose a contact on the lock screen.
  return hideContent !== false
    ? { title: "Trivo Chat", body: "Новое сообщение" }
    : {
      title: visibleText(title, 120, "Trivo Chat"),
      body: visibleText(body, 500, "Новое сообщение"),
    };
}

/** Avoid overwriting back-to-back Android notifications within one process. */
let lastNotificationId = 0;
export function nextLocalNotificationId(): number {
  const max = 2_147_483_646;
  if (lastNotificationId === 0) {
    lastNotificationId = crypto.getRandomValues(new Uint32Array(1))[0] % max + 1;
  } else {
    lastNotificationId = lastNotificationId % max + 1;
  }
  return lastNotificationId;
}

/** Only actual boolean strings are accepted from untrusted DOM storage.
 * In particular a damaged "hide-content" value must NOT be interpreted as
 * permission to display private content in a lock-screen notification.
 */
export function readNotificationPreference(
  key: string,
  value: string | null,
  fallback: boolean,
): boolean {
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return notificationPreferenceUnavailable(key, fallback);
}

/** A failed privacy preference read must not reveal notifications. */
export function notificationPreferenceUnavailable(key: string, fallback: boolean): boolean {
  if (key === "trivo-notifications") return false;
  if (key === "trivo-hide-content") return true;
  return fallback;
}
