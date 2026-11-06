/** Serialize mutations for one incoming media file without blocking
 * unrelated transfers. A failed task never poisons later retries. The tail
 * is removed after the final queued task, avoiding unbounded map growth.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    const tail: Promise<void> = task.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return task;
  }
}
