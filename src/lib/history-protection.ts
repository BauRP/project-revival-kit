/**
 * Per-peer protection against REMOTE edit/delete-for-everyone actions.
 *
 * The recipient is the enforcement authority: a modified peer application
 * cannot change a protected message in our local Dexie database. The peer's
 * published state is an advisory UX signal and is cached for offline use.
 * No server, subscriptions or third-party services.
 */
import { dxdb, type LifecycleRecord } from "./dexie-db";
import { isValidOnion } from "./onion-id";
import { onionOnConnectionChange, onionRegisterIncomingListener, onionSendDispatch } from "./onion-engine";

export interface HistoryProtectionState {
  enabled: boolean;
  updatedAt: number;
}
export const HISTORY_PROTECTION_NOTICE =
  "У пользователя включена защита истории переписки.";

export class HistoryProtectionError extends Error {
  constructor() {
    super(HISTORY_PROTECTION_NOTICE);
    this.name = "HistoryProtectionError";
  }
}

export function localProtectionKey(peer: string): string {
  return `history-protection::local::${peer}`;
}
export function remoteProtectionKey(peer: string): string {
  return `history-protection::remote::${peer}`;
}
/** Only remote author-driven edit and delete-for-everyone are denied.
 * "Delete for me" never goes over Tor and remains allowed. */
export function deniedByHistoryProtection(
  enabled: boolean,
  patch: Record<string, unknown>,
): boolean {
  return enabled && (
    "isEdited" in patch || "editedText" in patch || "deletedForEveryone" in patch
  );
}

export function validProtectionUpdate(
  enabled: unknown, updatedAt: unknown, now = Date.now(),
): enabled is boolean {
  return typeof enabled === "boolean" &&
    typeof updatedAt === "number" && Number.isSafeInteger(updatedAt) &&
    updatedAt > 0 && updatedAt <= now + 10 * 60_000;
}
/** Two fast toggles must never share the same timestamp. */
export function nextProtectionUpdateAt(previous: number, now: number): number {
  if (!Number.isSafeInteger(previous) || previous < 0 ||
      !Number.isSafeInteger(now) || now <= 0)
    throw new Error("Invalid protection timestamp");
  return Math.max(now, previous + 1);
}
export function parseHistoryProtectionState(data?: Record<string, unknown>): HistoryProtectionState {
  if (data === undefined) return { enabled: false, updatedAt: 0 };
  if (typeof data.enabled !== "boolean" ||
      typeof data.updatedAt !== "number" ||
      !Number.isSafeInteger(data.updatedAt) || data.updatedAt <= 0)
    throw new Error("History protection record is corrupted");
  return { enabled: data.enabled, updatedAt: data.updatedAt };
}
export async function getLocalHistoryProtection(peer: string): Promise<HistoryProtectionState> {
  const record = await dxdb.lifecycle.get(localProtectionKey(peer));
  if (record && !record.data)
    throw new Error("History protection record is corrupted");
  return parseHistoryProtectionState(record?.data);
}
export async function getRemoteHistoryProtection(peer: string): Promise<HistoryProtectionState> {
  const record = await dxdb.lifecycle.get(remoteProtectionKey(peer));
  if (record && !record.data)
    throw new Error("History protection record is corrupted");
  return parseHistoryProtectionState(record?.data);
}
export async function assertRemoteHistoryAllowsChanges(peer: string): Promise<void> {
  const state = await getRemoteHistoryProtection(peer);
  if (state.enabled) throw new HistoryProtectionError();
}

/** Called by the chat menu. Store locally FIRST, then queue a sealed Tor update. */
export async function setLocalHistoryProtection(
  self: string, peer: string, enabled: boolean,
): Promise<HistoryProtectionState> {
  if (!isValidOnion(self) || !isValidOnion(peer) || self === peer)
    throw new Error("History protection requires a valid peer chat");
  const state = await dxdb.transaction("rw", [dxdb.lifecycle, dxdb.outbox], async () => {
    const prev = await dxdb.lifecycle.get(localProtectionKey(peer));
    const updatedAt = nextProtectionUpdateAt(
      (() => {
        if (prev && !prev.data)
          throw new Error("History protection record is corrupted");
        return parseHistoryProtectionState(prev?.data).updatedAt;
      })(), Date.now(),
    );
    const record: LifecycleRecord = {
      key: localProtectionKey(peer),
      chatKey: "history-protection-local", messageId: peer,
      data: { enabled, updatedAt }, updatedAt,
    };
    await dxdb.lifecycle.put(record);
    // A newer privacy toggle supersedes every unacknowledged old frame.
    // Preserve a single transaction so no reconnect can read a mixed state.
    await dxdb.outbox.where("peer").equals(peer)
      .filter((queued) => queued.kind === "history_protection").delete();
    return { enabled, updatedAt };
  });
  emitLocal(peer, state);
  // Network availability is not required. The durable sealed outbox retains
  // the newest toggle until the recipient reconnects.
  // Await durable sealing/queue insertion before the setting is reported as
  // synchronized. A temporarily unreachable peer is fine: its frame remains
  // in the Tor outbox. Failure to seal is explicitly surfaced to the caller.
  await publishHistoryProtection(peer, state);
  return state;
}

/** Re-announce the latest durable state on a fresh authenticated Tor link.
 * A missed toggle is otherwise possible if the original outbound queue was
 * interrupted before persistence. Duplicate updates are idempotent on receipt.
 */
async function publishHistoryProtection(peer: string, state: HistoryProtectionState): Promise<void> {
  await onionSendDispatch(peer, {
    type: "history_protection",
    id: crypto.randomUUID(),
    enabled: state.enabled,
    updatedAt: state.updatedAt,
  });
}

const lastRepublished = new Map<string, number>();
onionOnConnectionChange((peer, connected) => {
  if (!connected || !isValidOnion(peer)) return;
  const now = Date.now();
  if (now - (lastRepublished.get(peer) || 0) < 60_000) return;
  lastRepublished.set(peer, now);
  void getLocalHistoryProtection(peer).then((state) => {
    if (state.updatedAt > 0) return publishHistoryProtection(peer, state);
  }).catch((error) => {
    lastRepublished.delete(peer);
    console.warn("[history-protection] reconnect sync failed", error);
  });
});

const localListeners = new Set<(peer: string, state: HistoryProtectionState) => void>();
const remoteListeners = new Set<(peer: string, state: HistoryProtectionState) => void>();
function emitLocal(peer: string, state: HistoryProtectionState): void {
  localListeners.forEach((cb) => cb(peer, state));
}
export function onLocalHistoryProtection(
  peer: string, callback: (state: HistoryProtectionState) => void,
): () => void {
  const cb = (current: string, state: HistoryProtectionState) => {
    if (current === peer) callback(state);
  };
  localListeners.add(cb);
  return () => { localListeners.delete(cb); };
}
export function onRemoteHistoryProtection(
  peer: string, callback: (state: HistoryProtectionState) => void,
): () => void {
  const cb = (current: string, state: HistoryProtectionState) => {
    if (current === peer) callback(state);
  };
  remoteListeners.add(cb);
  return () => { remoteListeners.delete(cb); };
}

onionRegisterIncomingListener((payload) => {
  if (payload.type !== "history_protection") return;
  const peer = String(payload.from || "");
  if (!isValidOnion(peer)) return;
  void getRemoteHistoryProtection(peer).then((state) => {
    remoteListeners.forEach((cb) => cb(peer, state));
  }).catch((error) => console.warn("[history-protection] status read failed", error));
});
