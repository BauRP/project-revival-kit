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
export function safeNotificationText(
  title: string, body: string, hideContent: boolean,
): { title: string; body: string } {
  return hideContent
    ? { title: "Trivo Chat", body: "Новое сообщение" }
    : { title: title.slice(0, 120), body: body.slice(0, 500) };
}
