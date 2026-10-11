// ============================================================================
//  Friend requests, read receipts and startup recovery — all over the sealed
//  Tor outbox (src/lib/onion-engine.ts). Peers are `.onion` addresses only.
// ============================================================================

import { dbGet, dbGetAll } from "../storage";
import { onionRegisterIncomingListener, onionSendDispatch, recoverInbox } from "../onion-engine";

export interface FriendRequest {
  from: string;
  to: string;
  fromName: string;
  timestamp: number;
  status: "pending" | "accepted" | "declined";
}

export async function sendFriendRequest(request: Omit<FriendRequest, "status" | "timestamp">) {
  const timestamp = Date.now();
  const { dbPut } = await import("../storage");
  await dbPut("settings", `friend-req-out-${request.to}`, { ...request, timestamp, status: "pending" });
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
  void dbGetAll<FriendRequest & { type?: string }>("settings").then((all) => {
    for (const r of all) {
      if (r && r.type === "friend_request" && r.to === self && r.status === "pending") onRequest(r);
    }
  });
  return onionRegisterIncomingListener((data) => {
    if (data.type !== "friend_request") return;
    onRequest({
      from: String(data.from),
      to: self,
      fromName: String(data.fromName || ""),
      timestamp: Number(data.timestamp) || Date.now(),
      status: "pending",
    });
  });
}

export async function acceptFriendRequest(fromOnion: string): Promise<void> {
  const { dbPut } = await import("../storage");
  const stored = await dbGet<FriendRequest>("settings", `friend-req-in-${fromOnion}`);
  if (stored) await dbPut("settings", `friend-req-in-${fromOnion}`, { ...stored, status: "accepted" });
  await onionSendDispatch(fromOnion, {
    type: "friend_request_status",
    id: `frs-${fromOnion}-${Date.now()}`,
    status: "accepted",
    timestamp: Date.now(),
  });
}

export async function getOutgoingRequestStatus(toOnion: string): Promise<"pending" | "accepted" | "none"> {
  const local = await dbGet<FriendRequest>("settings", `friend-req-out-${toOnion}`);
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
