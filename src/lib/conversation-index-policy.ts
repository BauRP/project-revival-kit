/** Merge the two indexed chat queries without duplicating a self-directed
 * message. Expiration happens before display; sorting is stable for same-ms
 * messages, which matters when reopening long conversations.
 */
export interface ConversationRow {
  id: string;
  timestamp: number;
  deleteAt?: number;
}
export function mergeConversationRows<T extends ConversationRow>(
  sentToPeer: readonly T[], receivedFromPeer: readonly T[],
  now: number,
): T[] {
  const byId = new Map<string,T>();
  for (const row of sentToPeer) byId.set(row.id,row);
  for (const row of receivedFromPeer) {
    if (!byId.has(row.id)) byId.set(row.id,row);
  }
  return Array.from(byId.values())
    .filter(row => !row.deleteAt || row.deleteAt > now)
    .sort((a,b) => a.timestamp-b.timestamp || a.id.localeCompare(b.id));
}
