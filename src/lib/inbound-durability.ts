/** Friend events require a second durable IndexedDB transaction before ACK. */
export function isLegacyFriendEvent(type: string): boolean {
  return type === "friend_request" || type === "friend_request_status";
}
