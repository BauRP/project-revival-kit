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
