/**
 * The contact set can change without changing its length. Track identities,
 * not count, when creating and removing presence/profile subscriptions.
 * Onion IDs have no null bytes, so the separator cannot collide with an ID.
 */
export function contactSubscriptionKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("\u0000");
}

export function subscribeContactIds(
  ids: readonly string[],
  subscribePresence: (id: string) => () => void,
  subscribeProfile: (id: string) => () => void,
): () => void {
  const cleanup: Array<() => void> = [];
  try {
    for (const id of new Set(ids)) {
      cleanup.push(subscribePresence(id));
      cleanup.push(subscribeProfile(id));
    }
  } catch (error) {
    for (const release of cleanup.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of cleanup.reverse()) release();
  };
}
