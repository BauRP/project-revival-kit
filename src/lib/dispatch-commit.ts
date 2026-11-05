/** A durable acknowledgement is evidence of an accepted, persisted event.
 * Invalid/unrecognized payloads must NOT be marked delivered to the sender.
 * A duplicate is accepted but should not re-trigger UI side effects.
 */
export type DispatchCommitResult = "committed" | "duplicate" | "rejected";

export function shouldAckDispatch(result: DispatchCommitResult): boolean {
  return result !== "rejected";
}

export function shouldNotifyDispatch(result: DispatchCommitResult): boolean {
  return result === "committed";
}

export function isValidDispatchId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 1 && id.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(id);
}

/** A reused dispatch ID must never silently redirect an in-flight encrypted
 * frame to another peer or a different event category.
 */
export function sameOutgoingDispatchRoute(
  expected: { peer: string; kind: string },
  actual: { peer: string; kind: string },
): boolean {
  return expected.peer === actual.peer && expected.kind === actual.kind;
}
