/** Monotonic message delivery states, independent of transport retries.
 * TCP acceptance is only "sent"; "delivered" requires the recipient's
 * authenticated ACK after its durable database commit.
 */
export type DeliveryStatus = "pending" | "sent" | "delivered" | "read";
const ORDER: Readonly<Record<DeliveryStatus, number>> = {
  pending: 0, sent: 1, delivered: 2, read: 3,
};
export function advanceDeliveryStatus(
  current: DeliveryStatus, incoming: DeliveryStatus,
): DeliveryStatus {
  return ORDER[incoming] > ORDER[current] ? incoming : current;
}

/** In-memory UI events are monotonic too: a late TCP "sent" callback may
 * finish after the already delivered ACK. Keep the stored state authoritative.
 */
export type DeliveryEvent = "sent" | "delivered";
export function shouldEmitDeliveryEvent(
  previous: DeliveryEvent | undefined, incoming: DeliveryEvent,
): boolean {
  return previous !== incoming && previous !== "delivered";
}

/** Only durable ACKs for a still-present text message can advance the
 * chat's delivery indicator. Other sealed event categories have ACKs too.
 */
export function shouldNotifyMessageAcknowledgement(
  kind: string, messageStillExists: boolean,
): boolean {
  return kind === "text_message" && messageStillExists;
}

/** The immutable sealed frame and original route must still match after
 * network I/O. An ID reused by another event is never updated by stale I/O.
 */
export function sameOutboxFrameForResult(
  current: { id: string; peer: string; kind: string; frame: string; createdAt: number },
  original: { id: string; peer: string; kind: string; frame: string; createdAt: number },
): boolean {
  return current.id === original.id && current.peer === original.peer &&
    current.kind === original.kind && current.frame === original.frame &&
    current.createdAt === original.createdAt;
}

/** Prevent a signed ACK for a coincidentally reused ID from changing a
 * local message addressed to a different peer.
 */
export function shouldAcceptTextMessageAck(
  message: { to: string }, authenticatedPeer: string,
): boolean {
  return message.to === authenticatedPeer;
}
