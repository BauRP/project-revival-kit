/** A raw signed frame can arrive simultaneously through the native
 * replay queue, live transport notification and WebView crash recovery.
 * Coalesce by frame identity until the durable write AND processing settle.
 * A rejected attempt must be retryable: never cache its failure.
 */
export class InboundFrameSingleFlight {
  private readonly active = new Map<string, Promise<void>>();

  run(id: string, commit: () => Promise<void>): Promise<void> {
    const current = this.active.get(id);
    if (current) return current;
    const work = Promise.resolve().then(commit);
    this.active.set(id, work);
    // Cleanup on success and failure. Attach a rejection handler to this
    // internal cleanup chain; the caller still receives the real rejection.
    void work.finally(() => {
      if (this.active.get(id) === work) this.active.delete(id);
    }).catch(() => undefined);
    return work;
  }
}
