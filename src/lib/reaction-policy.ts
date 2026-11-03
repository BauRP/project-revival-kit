/** Ignore older and equal-timestamp signed reactions. A repeated Tor retry
 * must not roll the visible state back or trigger another UI notification.
 */
export function shouldApplyRemoteReaction(previousAt: unknown, incomingAt: number): boolean {
  return typeof previousAt !== "number" ||
    (Number.isSafeInteger(previousAt) && incomingAt > previousAt);
}
