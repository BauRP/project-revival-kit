/**
 * Trivo Support (Bot) — public API.
 *
 * The heavy lifting (NLP.js training + neural classification) runs inside a
 * dedicated Web Worker so the chat UI never blocks. If workers are not
 * available in the current runtime (very old WebViews, SSR), the same engine
 * is imported lazily and executed in place — behaviour is identical, only the
 * thread differs.
 *
 * Everything is on-device: no network requests, ever.
 */
export type BotLang = "ru" | "en";

type WorkerResponse =
  | { id: number; ok: true; reply: string }
  | { id: number; ok: false; error: string };

export class SupportBot {
  private worker: Worker | null = null;
  private workerFailed = false;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (reply: string) => void; reject: (err: Error) => void }
  >();

  private getWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      this.workerFailed = true;
      return null;
    }
    try {
      const worker = new Worker(new URL("./workers/nlp.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        const entry = this.pending.get(data?.id);
        if (!entry) return;
        this.pending.delete(data.id);
        if (data.ok) entry.resolve(data.reply);
        else entry.reject(new Error(data.error));
      };
      worker.onerror = (event) => {
        this.workerFailed = true;
        const err = new Error(event.message || "NLP worker crashed");
        for (const [, entry] of this.pending) entry.reject(err);
        this.pending.clear();
        try {
          worker.terminate();
        } catch {
          /* noop */
        }
        this.worker = null;
      };
      this.worker = worker;
      return worker;
    } catch (err) {
      console.warn("[support-bot] worker unavailable, running inline", err);
      this.workerFailed = true;
      return null;
    }
  }

  private post(message: { type: "warmup" } | { type: "reply"; text: string; lang?: BotLang }): Promise<string> | null {
    const worker = this.getWorker();
    if (!worker) return null;
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...message });
    });
  }

  /**
   * Optional: pre-trains the on-device model in the background so the very
   * first user question answers instantly.
   */
  public async warmup(): Promise<void> {
    try {
      const viaWorker = this.post({ type: "warmup" });
      if (viaWorker) {
        await viaWorker;
        return;
      }
      const engine = await import("./support-nlp-engine");
      await engine.warmup();
    } catch (err) {
      console.warn("[support-bot] warmup failed", err);
    }
  }

  /**
   * Main entry point. Asynchronous: the NLP pipeline runs off the main thread.
   */
  public async getReply(userMessage: string, requestedLang?: BotLang): Promise<string> {
    try {
      const viaWorker = this.post({ type: "reply", text: userMessage, lang: requestedLang });
      if (viaWorker) return await viaWorker;
    } catch (err) {
      console.warn("[support-bot] worker reply failed, falling back inline", err);
    }
    const engine = await import("./support-nlp-engine");
    return engine.resolveReply(userMessage, requestedLang);
  }
}

export const supportBot = new SupportBot();