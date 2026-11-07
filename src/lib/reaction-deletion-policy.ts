/**
 * A locally deleted message must not regain reactions through late signed
 * Tor retransmissions, old IndexedDB state, pending outbox tasks or backups.
 * This is a privacy invariant independent of UI visibility.
 */
import { isDeletedMessageRecord } from "./message-deletion-policy";

type MessageParticipants = { id?: string; from?: string; to?: string } | null | undefined;

export function canReactToVisibleMessage(
  message: MessageParticipants,
  peer: string,
  self: string,
  localDeletion: unknown,
): boolean {
  if (!message || !message.id || !peer || !self || peer === self ||
      isDeletedMessageRecord(localDeletion)) return false;
  return (message.from === peer && message.to === self) ||
    (message.from === self && message.to === peer);
}

/** Remove stale legacy + Dexie reaction data only for locally deleted messages. */
export function pruneDeletedReactionMap<T>(
  map: Record<string, T>,
  deletedIds: ReadonlySet<string>,
): Record<string, T> {
  const safe: Record<string, T> = Object.create(null) as Record<string, T>;
  for (const [id, reaction] of Object.entries(map)) {
    if (!deletedIds.has(id)) Object.defineProperty(safe, id, {
      value: reaction, enumerable: true, configurable: true, writable: true,
    });
  }
  return safe;
}
