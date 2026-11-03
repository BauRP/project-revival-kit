/** A local deletion marker is terminal for the original text dispatch.
 * Check during the same Dexie write transaction as queue insertion.
 */
export function mayQueueOriginalText(deletionRecord: unknown): boolean {
  if (!deletionRecord || typeof deletionRecord !== "object" ||
      Array.isArray(deletionRecord)) return true;
  return (deletionRecord as Record<string, unknown>).deleted !== true;
}
