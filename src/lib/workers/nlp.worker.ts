/// <reference lib="webworker" />
/**
 * Dedicated NLP worker. Training and classification of the offline Trivo
 * Support model happen here so the UI thread never blocks.
 */
import { resolveReply, warmup, type BotLang } from "../support-nlp-engine";

type Request =
  | { id: number; type: "warmup" }
  | { id: number; type: "reply"; text: string; lang?: BotLang };

type Response =
  | { id: number; ok: true; reply: string }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  if (!req || typeof req.id !== "number") return;
  try {
    if (req.type === "warmup") {
      await warmup();
      (self as unknown as Worker).postMessage({ id: req.id, ok: true, reply: "" } satisfies Response);
      return;
    }
    const reply = await resolveReply(req.text, req.lang);
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, reply } satisfies Response);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies Response);
  }
};