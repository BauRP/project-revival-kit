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
import { onionRegisterIncomingListener, onionSendDispatch } from "./onion-engine";

export interface HistoryProtectionState {
  enabled: boolean;
  updatedAt: number;
}
export const HISTORY_PROTECTION_NOTICE =
  "У пользователя включена защита истории переписки. Удаление у всех и редактирование недоступны.";

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
export function validProtectionUpdate(
  enabled: unknown, updatedAt: unknown, now = Date.now(),
): enabled is boolean {
  return typeof enabled === "boolean" &&
    typeof updatedAt === "number" && Number.isSafeInteger(updatedAt) &&
    updatedAt > 0 && updatedAt <= now + 10 * 60_000;
}
function stateOf(data?: Record<string, unknown>): HistoryProtectionState {
  return { enabled: data?.enabled === true, updatedAt: Number(data?.updatedAt || 0) };
}
export async function getLocalHistoryProtection(peer: string): Promise<HistoryProtectionState> {
  const record = await dxdb.lifecycle.get(localProtectionKey(peer));
  return stateOf(record?.data);
}
export async function getRemoteHistoryProtection(peer: string): Promise<HistoryProtectionState> {
  const record = await dxdb.lifecycle.get(remoteProtectionKey(peer));
  return stateOf(record?.data);
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
  const prev = await getLocalHistoryProtection(peer);
  const updatedAt = Math.max(Date.now(), prev.updatedAt + 1);
  const record: LifecycleRecord = {
    key: localProtectionKey(peer),
    chatKey: "history-protection-local", messageId: peer,
    data: { enabled, updatedAt }, updatedAt,
  };
  await dxdb.lifecycle.put(record);
  const state = { enabled, updatedAt };
  emitLocal(peer, state);
  // Network availability is not required. The durable sealed outbox retains
  // the newest toggle until the recipient reconnects.
  void onionSendDispatch(peer, {
    type: "history_protection", id: crypto.randomUUID(), enabled, updatedAt,
  }).catch((error) => console.warn("[history-protection] sync pending/failed", error));
  return state;
}

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
