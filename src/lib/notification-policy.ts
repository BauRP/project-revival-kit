/** Pure, offline-only notification delivery policy. */
export interface NotificationPolicyInput {
  enabled: boolean;
  mutedUntil?: number | null;
  blocked?: boolean;
  silent?: boolean;
}
export function shouldNotifyChat(input: NotificationPolicyInput, now: number = Date.now()): boolean {
  return input.enabled &&
    input.blocked !== true &&
    input.silent !== true &&
    !(typeof input.mutedUntil === "number" && input.mutedUntil > now);
}
/** Only visible Unicode text is allowed into system notifications. */
function visibleText(value: string, max: number, fallback: string): string {
  const cleaned = value.replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || fallback;
}
export function safeNotificationText(
  title: string, body: string, hideContent: boolean,
): { title: string; body: string } {
  return hideContent
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
