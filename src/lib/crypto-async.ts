// ============================================================================
//  Async crypto facade — keeps the UI thread free.
//  ---------------------------------------------------------------------------
//  Every call is dispatched to a dedicated Web Worker (crypto.worker.ts).
//  If workers are unavailable (very old WebView, SSR, or a worker that failed
//  to boot) the call transparently falls back to the synchronous tweetnacl
//  implementation, so behaviour is identical and nothing ever throws because
//  of the transport itself.
// ============================================================================

import {
  signData,
  verifySignature,
  encryptMessage,
  decryptMessage,
  generateIdentityKeysSync,
  type IdentityKeys,
} from "./crypto";
import { sealFrame, openFrame, type SealedFrame } from "./envelope";
import type { CryptoJobKind, CryptoJobResult } from "./workers/crypto.worker";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

const JOB_TIMEOUT_MS = 15_000;

function disposeWorker(reason: string) {
  workerBroken = true;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
  try {
    worker?.terminate();
  } catch {
    /* best effort */
  }
  worker = null;
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./workers/crypto.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<CryptoJobResult>) => {
      const result = event.data;
      const entry = result && pending.get(result.id);
      if (!entry) return;
      pending.delete(result.id);
      clearTimeout(entry.timer);
      if (result.ok) entry.resolve(result.value);
      else entry.reject(new Error(result.error || "crypto worker error"));
    });
    worker.addEventListener("error", () => disposeWorker("crypto worker crashed"));
    return worker;
  } catch (error) {
    console.warn("[crypto-async] worker unavailable, using main thread:", error);
    workerBroken = true;
    return null;
  }
}

function dispatch<T>(
  kind: CryptoJobKind,
  payload: Record<string, unknown>,
  fallback: () => T,
): Promise<T> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(fallback());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A stuck job must never hang the caller: fall back inline.
      try {
        resolve(fallback());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, JOB_TIMEOUT_MS);
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
    try {
      w.postMessage({ id, kind, payload });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      console.warn("[crypto-async] postMessage failed:", error);
      try {
        resolve(fallback());
      } catch (inner) {
        reject(inner instanceof Error ? inner : new Error(String(inner)));
      }
    }
  });
}

export function signDataAsync(data: string, secretKey: string): Promise<string> {
  return dispatch("sign", { data, secretKey }, () => signData(data, secretKey));
}

/**
 * Generate a fresh Ed25519 + X25519 identity in the crypto worker so the very
 * first render is never blocked by keypair generation.
 */
export function generateIdentityKeysAsync(): Promise<IdentityKeys> {
  const w = getWorker();
  if (!w) {
    return Promise.reject(
      new Error(
        "Secure crypto worker is unavailable; identity generation was not run on the UI thread",
      ),
    );
  }
  return dispatch<IdentityKeys>("keygen", {}, () => {
    throw new Error("Crypto worker timed out; refusing main-thread identity generation");
  });
}

export function verifySignatureAsync(
  data: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  return dispatch("verify", { data, signature, publicKey }, () =>
    verifySignature(data, signature, publicKey),
  );
}

export function encryptMessageAsync(
  plaintext: string,
  recipientPublicKey: string,
  senderSecretKey: string,
): Promise<{ ciphertext: string; nonce: string }> {
  return dispatch("encrypt", { plaintext, recipientPublicKey, senderSecretKey }, () =>
    encryptMessage(plaintext, recipientPublicKey, senderSecretKey),
  );
}

export function decryptMessageAsync(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string,
): Promise<string> {
  return dispatch("decrypt", { ciphertext, nonce, senderPublicKey, recipientSecretKey }, () =>
    decryptMessage(ciphertext, nonce, senderPublicKey, recipientSecretKey),
  );
}

/**
 * Parse JSON off the main thread. Small payloads are parsed inline because the
 * round-trip would cost more than the parse itself.
 */
export function parseJsonAsync<T>(raw: string): Promise<T> {
  if (raw.length < 8_192) {
    return Promise.resolve(JSON.parse(raw) as T);
  }
  return dispatch<T>("parse", { raw }, () => JSON.parse(raw) as T);
}

/** Stringify large objects off the main thread. */
export function stringifyJsonAsync(value: unknown): Promise<string> {
  const inline = () => JSON.stringify(value);
  try {
    const quick = inline();
    if (quick.length < 8_192) return Promise.resolve(quick);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return dispatch<string>("stringify", { value }, inline);
}

/** E2EE seal for Tor egress (worker, inline fallback). */
export function sealFrameAsync(
  inner: unknown,
  from: string,
  to: string,
  secretKey: string,
): Promise<SealedFrame> {
  return dispatch("seal", { inner, from, to, secretKey }, () =>
    sealFrame(inner, from, to, secretKey),
  );
}

/** Verify + decrypt an inbound frame (worker, inline fallback). */
export function openFrameAsync(
  frame: SealedFrame,
  self: string,
  secretKey: string,
): Promise<unknown> {
  return dispatch("open", { frame, self, secretKey }, () => openFrame(frame, self, secretKey));
}
