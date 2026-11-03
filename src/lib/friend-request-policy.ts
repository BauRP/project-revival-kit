import { isValidOnion } from "./onion-id";

/** Signed Tor envelope determines sender identity, not caller JSON fields. */
export interface ValidatedFriendRequest {
  from: string;
  to: string;
  fromName: string;
  timestamp: number;
  status: "pending";
  type: "friend_request";
}
export function validateIncomingFriendRequest(
  payload: Record<string, unknown>,
  now = Date.now(),
): ValidatedFriendRequest | null {
  if (!isValidOnion(payload.from) || !isValidOnion(payload.to) ||
      typeof payload.fromName !== "string" || payload.fromName.length > 80 ||
      /[\u0000-\u001f\u007f\u202a-\u202e]/.test(payload.fromName) ||
      !Number.isSafeInteger(payload.timestamp) ||
      (payload.timestamp as number) <= 0 ||
      (payload.timestamp as number) > now + 600_000)
    return null;
  return {
    type: "friend_request",
    from: payload.from as string, to: payload.to as string,
    fromName: payload.fromName, timestamp: payload.timestamp as number,
    status: "pending",
  };
}

/**
 * A replayed signed request can be delivered again after reconnect.
 * Do not undo an accepted/declined decision or replace a newer request.
 */
export function shouldApplyIncomingFriendRequest(
  previous: { status?: unknown; timestamp?: unknown } | undefined,
  incomingTimestamp: number,
): boolean {
  if (!previous) return true;
  if (previous.status === "accepted" || previous.status === "declined") return false;
  return typeof previous.timestamp !== "number" ||
    incomingTimestamp > previous.timestamp;
}

export function validateOutgoingFriendRequest(
  from: string, to: string, fromName: string,
): void {
  if (!isValidOnion(from) || !isValidOnion(to) ||
      typeof fromName !== "string" || fromName.length > 80 ||
      /[\u0000-\u001f\u007f\u202a-\u202e]/.test(fromName))
    throw new Error("Invalid friend request");
}
