// ============================================================================
//  Boot guard — the earliest JavaScript executed by the app.
//  ---------------------------------------------------------------------------
//  Imported for its side effects from `src/routes/__root.tsx`, so it runs
//  before any application module (contexts, crypto, Dexie, Capacitor plugins)
//  has a chance to throw.
//
//  Responsibilities:
//    1. Install the in-memory Web Storage fallback when the Android WebView
//       blocks DOM storage (a synchronous throw there is the classic cause of
//       "Trivo Chat Elite keeps stopping" on launch).
//    2. Attach `window.onerror` and `window.onunhandledrejection` listeners so
//       no unhandled JS exception can escape into the native layer.
//    3. Record the last fatal error and notify subscribers, which lets the
//       React ErrorBoundary render the Emergency Diagnostic Screen with the
//       real message and stack instead of a white/killed WebView.
//
//  It is SSR-safe: every branch short-circuits when `window` is undefined.
// ============================================================================

import { installStorageFallback } from "@/lib/safe-storage";

export interface FatalErrorRecord {
  message: string;
  stack: string;
  source: "window.onerror" | "unhandledrejection" | "react" | "manual";
  at: number;
}

type FatalListener = (record: FatalErrorRecord) => void;

const listeners = new Set<FatalListener>();
let lastFatal: FatalErrorRecord | null = null;
let installed = false;

function toRecord(error: unknown, source: FatalErrorRecord["source"]): FatalErrorRecord {
  let message = "Unknown error";
  let stack = "";
  if (error instanceof Error) {
    message = error.message || error.name || "Unknown error";
    stack = error.stack || "";
  } else if (typeof error === "string") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }
  return { message, stack, source, at: Date.now() };
}

export function reportFatalError(
  error: unknown,
  source: FatalErrorRecord["source"] = "manual",
): FatalErrorRecord {
  const record = toRecord(error, source);
  lastFatal = record;
  try {
    console.error(`[trivo:fatal:${source}]`, error);
  } catch {
    /* console can be absent in stripped WebViews */
  }
  listeners.forEach((listener) => {
    try {
      listener(record);
    } catch {
      /* a broken listener must never re-throw */
    }
  });
  return record;
}

export function getLastFatalError(): FatalErrorRecord | null {
  return lastFatal;
}

export function clearFatalError(): void {
  lastFatal = null;
}

export function subscribeToFatalErrors(listener: FatalListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installBootGuard(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // (1) Storage first: everything else may depend on it.
  try {
    installStorageFallback();
  } catch (error) {
    console.warn("[trivo] storage fallback installation failed:", error);
  }

  // (2) Global synchronous error trap.
  try {
    window.addEventListener(
      "error",
      (event: ErrorEvent) => {
        // Resource load errors (missing chunk, image) surface here too; only
        // real exceptions are treated as fatal so a 404 asset cannot blank
        // the UI on its own.
        if (!event.error && !event.message) return;
        reportFatalError(event.error ?? event.message, "window.onerror");
      },
      true,
    );
  } catch (error) {
    console.warn("[trivo] window error listener failed:", error);
  }

  // (3) Promise rejection trap — Capacitor plugin calls reject asynchronously.
  try {
    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      // Prevent the runtime from escalating this into a native process abort.
      try {
        event.preventDefault();
      } catch {
        /* not all WebViews allow preventDefault here */
      }
      reportFatalError(event.reason, "unhandledrejection");
    });
  } catch (error) {
    console.warn("[trivo] rejection listener failed:", error);
  }
}

// Side-effect install at module evaluation time (client only). The outer guard
// is intentionally redundant: this executes before React/router boundaries
// exist, so even an exotic host-object failure must not abort module loading.
try {
  installBootGuard();
} catch (error) {
  try {
    console.error("[trivo] boot guard could not be installed:", error);
  } catch {
    /* no recovery surface exists this early */
  }
}
