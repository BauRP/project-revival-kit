import { isValidOnion } from "./onion-id";
import { isLocalSupportPeer } from "./local-only-peer-policy";
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
export function scheduledWakeAt(
  item: ScheduledRetryState, now = Date.now(),
): number {
  const retry = item.nextAttemptAt ?? item.scheduledAt;
  // If Android's clock was corrected backwards after a previous Tor retry,
  // an obsolete future retry timestamp must not stall a due message for
  // days. The actual requested scheduledAt is NEVER moved earlier.
  const maxRetryDelay = 61 * 60_000;
  if ((item.attempts ?? 0) > 0 && retry > now + maxRetryDelay)
    return Math.max(item.scheduledAt, now);
  return Math.max(item.scheduledAt, retry);
}
/** Keep only the earliest due schedules while scanning IndexedDB.
 * A large pending queue must not load every encrypted text into JS memory.
 * The caller validates persisted rows before passing them here.
 */
export function retainDueScheduled<T extends ScheduledRetryState & { id: string }>(
  due: T[], item: T, now: number, limit = 64,
): void {
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new Error("Invalid due schedule batch");
  const wake = scheduledWakeAt(item, now);
  if (wake > now) return;
  const before = (other: T): boolean => {
    const otherWake = scheduledWakeAt(other, now);
    return wake < otherWake || (wake === otherWake && item.id < other.id);
  };
  const at = due.findIndex(before);
  if (at === -1) due.push(item);
  else due.splice(at, 0, item);
  if (due.length > limit) due.pop();
}

export function nextScheduledRetry<T extends ScheduledRetryState>(
  item: T, now: number,
): T {
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(item.scheduledAt) || item.scheduledAt <= 0 ||
      (item.attempts !== undefined &&
       (!Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.attempts > 1000)))
    throw new Error("Invalid scheduled retry clock or attempts");
  const attempts = Math.min(1000, (item.attempts ?? 0) + 1);
  const delay = Math.min(30_000 * 2 ** Math.min(attempts - 1, 7), 60 * 60_000);
  const nextAttemptAt = now + delay;
  if (!Number.isSafeInteger(nextAttemptAt))
    throw new Error("Scheduled retry clock overflow");
  return { ...item, attempts, nextAttemptAt };
}

/** A durable schedule cannot be changed while its sealed Tor frame exists. */
export function validateScheduledItem(item: { id: string; chatId: string; text: string; scheduledAt: number; silent: boolean }): void {
  if (typeof item.id !== "string" || !item.id || item.id.length > 128 || /[\u0000-\u001f\u007f]/.test(item.id)) throw new Error("Invalid scheduled message ID");
  if (typeof item.chatId !== "string" || !item.chatId || item.chatId.length > 128) throw new Error("Invalid scheduled destination");
  if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 200000) throw new Error("Invalid scheduled text");
  if (!Number.isSafeInteger(item.scheduledAt) || item.scheduledAt <= 0) throw new Error("Invalid scheduled time");
  if (typeof item.silent !== "boolean") throw new Error("Invalid scheduled notification mode");
}

/**
 * On Android the queued text is an authenticated Keystore ciphertext, whose
 * encoded size can exceed the original 200k-character plaintext limit.
 * Validate its persisted metadata without misclassifying valid encrypted
 * schedules as corrupt and blocking the entire outbox. The decrypted text
 * still passes validateScheduledItem() before actual delivery.
 */
export function validateStoredScheduledItem(
  item: {
    id: string; chatId: string; text: string; silent: boolean;
    scheduledAt: number; createdAt: number; attempts?: number; nextAttemptAt?: number;
  },
  encrypted: boolean,
): void {
  validateScheduledItem(encrypted ? { ...item, text: "keystore-protected" } : item);
  if (encrypted && (typeof item.text !== "string" || item.text.length > 512_000))
    throw new Error("Corrupted encrypted scheduled message");
  if (!Number.isSafeInteger(item.createdAt) || item.createdAt <= 0 ||
      (item.attempts !== undefined &&
        (!Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.attempts > 1000)) ||
      (item.nextAttemptAt !== undefined &&
        (!Number.isSafeInteger(item.nextAttemptAt) || item.nextAttemptAt < 0)))
    throw new Error("Corrupted scheduled message retry metadata");
}

/** Only the exact same queued item may be retried after an attempted send.
 * In particular a cancellation/recreation must never be overwritten by an
 * older callback rescheduling its obsolete data.
 */
export function sameScheduledIdentity(
  expected: { id: string; chatId: string; text: string; scheduledAt: number; createdAt: number },
  current: { id: string; chatId: string; text: string; scheduledAt: number; createdAt: number } | undefined,
): boolean {
  return !!current && current.id === expected.id &&
    current.chatId === expected.chatId && current.text === expected.text &&
    current.scheduledAt === expected.scheduledAt &&
    current.createdAt === expected.createdAt;
}

/** The exact persisted version of a schedule, including retry metadata.
 * A second WebView may cancel, replace or reschedule the same ID while a
 * Keystore operation or network dispatch is waiting. Identity alone is not
 * enough: stale callbacks must never overwrite the newer durable state.
 */
export interface ScheduledQueueSnapshot extends ScheduledRetryState {
  id: string;
  chatId: string;
  text: string;
  silent: boolean;
  createdAt: number;
}
export function sameScheduledState(
  expected: ScheduledQueueSnapshot,
  current: ScheduledQueueSnapshot | undefined,
): boolean {
  return sameScheduledIdentity(expected, current) &&
    current?.silent === expected.silent &&
    current?.attempts === expected.attempts &&
    current?.nextAttemptAt === expected.nextAttemptAt;
}

/** Reject permanently undeliverable recipients while preserving the local
 * test-bot fixture, which is never routed over Tor.
 */
export function canScheduleRecipient(peer: string): boolean {
  // Peer identity is a canonical lowercase v3 .onion host, not a URL or
  // display string. isValidOnion normalizes URLs for convenience in other
  // UI contexts; never apply that normalization at a durable queue boundary.
  return isLocalSupportPeer(peer) ||
    (typeof peer === "string" && /^[a-z2-7]{56}\.onion$/.test(peer) && isValidOnion(peer));
}
