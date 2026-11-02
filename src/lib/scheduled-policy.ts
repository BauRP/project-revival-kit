/**
 * Scheduled messages keep their ORIGINAL timestamp/identity through retries.
 * The retry wake time must never replace scheduledAt; otherwise a retry
 * collides with an already sealed Tor dispatch carrying the old timestamp.
 */
export interface ScheduledRetryState {
  scheduledAt: number;
  nextAttemptAt?: number;
  attempts?: number;
}
export function scheduledWakeAt(item: ScheduledRetryState): number {
  return Math.max(item.scheduledAt, item.nextAttemptAt ?? item.scheduledAt);
}
export function nextScheduledRetry<T extends ScheduledRetryState>(
  item: T, now: number,
): T {
  const attempts = Math.min(1000, (item.attempts ?? 0) + 1);
  const delay = Math.min(30_000 * 2 ** Math.min(attempts - 1, 7), 60 * 60_000);
  return { ...item, attempts, nextAttemptAt: now + delay };
}

/** A durable schedule cannot be changed while its sealed Tor frame exists. */
export function validateScheduledItem(item: { id: string; chatId: string; text: string; scheduledAt: number; silent: boolean }): void {
  if (!item.id || item.id.length > 128 || /[\u0000-\u001f\u007f]/.test(item.id)) throw new Error("Invalid scheduled message ID");
  if (typeof item.chatId !== "string" || !item.chatId || item.chatId.length > 128) throw new Error("Invalid scheduled destination");
  if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 200000) throw new Error("Invalid scheduled text");
  if (!Number.isSafeInteger(item.scheduledAt) || item.scheduledAt <= 0) throw new Error("Invalid scheduled time");
  if (typeof item.silent !== "boolean") throw new Error("Invalid scheduled notification mode");
}
