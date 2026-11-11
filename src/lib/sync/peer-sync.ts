// ============================================================================
//  Friend requests, read receipts and startup recovery — all over the sealed
//  Tor outbox (src/lib/onion-engine.ts). Peers are `.onion` addresses only.
// ============================================================================

import { dbGetStrict, dbGetAllStrict } from "../storage";
import { updateLegacySetting } from "../legacy-setting-cas";
import { validateOutgoingFriendRequest } from "../friend-request-policy";
import { onionRegisterIncomingListener, onionSendDispatch, recoverInbox } from "../onion-engine";

export interface FriendRequest {
  from: string;
  to: string;
  fromName: string;
  timestamp: number;
  status: "pending" | "accepted" | "declined";
}

export async function sendFriendRequest(request: Omit<FriendRequest, "status" | "timestamp">) {
  validateOutgoingFriendRequest(request.from, request.to, request.fromName);
  const timestamp = Date.now();
  const saved = await updateLegacySetting<FriendRequest>(
    `friend-req-out-${request.to}`, (previous) => {
      // A resend must never turn an accepted friendship back to pending.
      if (previous?.status === "accepted" ||
          (previous?.status === "pending" && previous.timestamp >= timestamp))
        return undefined;
      // A declined *outgoing* request may be explicitly sent again by the user.
      return { ...request, timestamp, status: "pending" };
    });
  if (!saved.changed) return;
  await onionSendDispatch(request.to, {
    type: "friend_request",
    id: `fr-${request.to}-${timestamp}`,
    fromName: request.fromName,
    timestamp,
  });
}

/** Replays stored inbound requests, then listens for new committed ones. */
export function listenForFriendRequests(
  self: string,
  onRequest: (req: FriendRequest) => void,
): () => void {
  let active = true;
  void dbGetAllStrict<FriendRequest & { type?: string }>("settings").then((all) => {
    if (!active) return;
    for (const r of all) {
      if (!active) break;
      if (r && r.type === "friend_request" && r.to === self && r.status === "pending")
        onRequest(r);
    }
  }).catch((error) => console.warn("[friends] saved request recovery failed", error));
  const stop = onionRegisterIncomingListener((data) => {
    if (!active || data.type !== "friend_request") return;
    onRequest({
      from: String(data.from),
      to: self,
      fromName: String(data.fromName || ""),
      timestamp: Number(data.timestamp) || Date.now(),
      status: "pending",
    });
  });
  return () => { active = false; stop(); };
}

export async function acceptFriendRequest(fromOnion: string): Promise<void> {
  const saved = await updateLegacySetting<FriendRequest>(
    `friend-req-in-${fromOnion}`, (stored) => {
      if (!stored || stored.status === "declined")
        throw new Error("No pending friend request for this authenticated peer");
      return stored.status === "accepted"
        ? undefined : { ...stored, status: "accepted" };
    });
  if (saved.value?.status !== "accepted")
    throw new Error("Friend acceptance was not committed");
  await onionSendDispatch(fromOnion, {
    type: "friend_request_status",
    id: `frs-${fromOnion}-${Date.now()}`,
    status: "accepted",
    timestamp: Date.now(),
  });
}

export async function getOutgoingRequestStatus(
  toOnion: string,
): Promise<"pending" | "accepted" | "none"> {
  const local = await dbGetStrict<FriendRequest>("settings", `friend-req-out-${toOnion}`);
  if (local?.status === "pending" || local?.status === "accepted") return local.status;
  return "none";
}

/** Read receipt. "delivered" is never sent from here — only the engine's ACK. */
export async function sendReadReceipt(senderOnion: string, messageId: string): Promise<void> {
  await onionSendDispatch(senderOnion, {
    type: "message_status",
    id: `ms-${messageId}-read`,
    messageId,
    status: "read",
  });
}

export function listenForReadReceipts(onRead: (messageId: string) => void): () => void {
  return onionRegisterIncomingListener((data) => {
    if (data.type === "message_status" && data.status === "read" && data.messageId) {
      onRead(String(data.messageId));
    }
  });
}

/** Boot-time recovery: replay inbound frames left in inbox_raw by a crash. */
export async function performStartupRecovery(): Promise<number> {
  return recoverInbox();
}
