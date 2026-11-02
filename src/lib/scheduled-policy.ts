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
