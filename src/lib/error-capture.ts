// ============================================================================
//  Out-of-band SSR error capture.
//  ---------------------------------------------------------------------------
//  h3 swallows in-handler throws into a plain 500 `Response`, so the original
//  Error never reaches the worker entry. These global listeners stash the most
//  recent error (short TTL) so the response normalizer in src/server.tsx can
//  correlate the 500 with a real stack trace and log it.
// ============================================================================

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown): void {
  lastCapturedError = { error, at: Date.now() };
}

try {
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("error", (event) => {
      record((event as ErrorEvent).error ?? event);
    });
    globalThis.addEventListener("unhandledrejection", (event) => {
      record((event as PromiseRejectionEvent).reason);
    });
  }
} catch {
  /* listener registration is best-effort; never break boot over it */
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
