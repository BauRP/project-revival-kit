/**
 * Transfer deadlines measure time since the last verified new chunk,
 * not time since the request started. Tor may carry large files slowly.
 * A stalled peer still releases its request slot after the idle timeout.
 */
export function hasTransferTimedOut(lastProgressAt: number, now: number, idleMs: number): boolean {
  if (!Number.isFinite(lastProgressAt) || !Number.isFinite(now) ||
      !Number.isFinite(idleMs) || idleMs <= 0 || lastProgressAt > now)
    throw new Error("Invalid media transfer deadline");
  return now - lastProgressAt >= idleMs;
}
