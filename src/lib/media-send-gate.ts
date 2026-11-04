/**
 * Bounded single-flight background Tor media sending.
 *
 * Inbound frame processing must not wait for thousands of outbound chunks.
 * Repeated requests for the same sender/file are coalesced while the receiver
 * can use its durable missing-chunk queue to request the rest later.
 */
export class MediaSendGate {
  private readonly active = new Set<string>();

  constructor(
    private readonly limit = 4,
    private readonly onError: (reason: unknown) => void = () => {},
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw new Error("Invalid media transfer concurrency limit");
  }

  start(peer: string, fileId: string, task: () => Promise<void>): boolean {
    if (!peer || !fileId) return false;
    const key = JSON.stringify([peer, fileId]);
    if (this.active.has(key) || this.active.size >= this.limit) return false;
    this.active.add(key);
    // The task begins in a microtask: inbound frame handling returns
    // immediately and the gate remains held through asynchronous cleanup.
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        try { this.onError(error); } catch { /* logging cannot poison cleanup */ }
      })
      .finally(() => { this.active.delete(key); });
    return true;
  }

  get activeCount(): number {
    return this.active.size;
  }
}
