// ============================================================================
//  Safe Web Storage layer.
//  ---------------------------------------------------------------------------
//  Android System WebView can hard-block DOM storage (privacy modes, "Clear
//  data on exit", enterprise policies, incognito-like containers, or a WebView
//  created before `setDomStorageEnabled(true)` is applied). In those cases the
//  *getter* `window.localStorage` itself throws a SecurityError — not just the
//  read/write calls. Any module-scope `localStorage.getItem(...)` then throws
//  during bundle evaluation, React never mounts, and Android reports the
//  process as "Trivo Chat Elite keeps stopping".
//
//  This module:
//    1. probes real storage availability exactly once (synchronously),
//    2. provides an in-memory Storage implementation with the full Web Storage
//       surface as a drop-in fallback,
//    3. can install that fallback onto `window.localStorage` /
//       `window.sessionStorage`, so every existing call site in the app keeps
//       working unchanged instead of throwing.
//
//  Nothing here touches the network or any native bridge, so it is safe during
//  SSR/prerender as well (all probes short-circuit when `window` is absent).
// ============================================================================

type StorageKind = "localStorage" | "sessionStorage";

/** Minimal but complete in-memory implementation of the Web Storage API. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    const value = this.map.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    if (index < 0 || index >= this.map.size) return null;
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
}

const memoryLocal = new MemoryStorage();
const memorySession = new MemoryStorage();

const availability: Record<StorageKind, boolean | null> = {
  localStorage: null,
  sessionStorage: null,
};

/**
 * Synchronous availability probe. Wrapped in try/catch because reading the
 * property, writing, and removing can each throw independently.
 */
export function isStorageAvailable(kind: StorageKind = "localStorage"): boolean {
  if (availability[kind] !== null) return availability[kind] as boolean;
  if (typeof window === "undefined") {
    availability[kind] = false;
    return false;
  }
  try {
    const store = window[kind] as Storage | undefined;
    if (!store) {
      availability[kind] = false;
      return false;
    }
    const probeKey = "__trivo_storage_probe__";
    store.setItem(probeKey, "1");
    const ok = store.getItem(probeKey) === "1";
    store.removeItem(probeKey);
    availability[kind] = ok;
    return ok;
  } catch {
    availability[kind] = false;
    return false;
  }
}

/** Returns real storage when usable, otherwise the in-memory fallback. */
export function getStorage(kind: StorageKind = "localStorage"): Storage {
  if (isStorageAvailable(kind)) {
    try {
      return window[kind] as Storage;
    } catch {
      /* fall through to memory */
    }
  }
  return kind === "localStorage" ? memoryLocal : memorySession;
}

/**
 * Replaces `window.localStorage` / `window.sessionStorage` with the in-memory
 * fallback when the real implementation is unusable. Called once from the boot
 * guard BEFORE any application module reads storage, which makes every legacy
 * `localStorage.getItem(...)` call site in the codebase crash-proof.
 */
export function installStorageFallback(): void {
  if (typeof window === "undefined") return;

  (["localStorage", "sessionStorage"] as StorageKind[]).forEach((kind) => {
    if (isStorageAvailable(kind)) return;
    const fallback = kind === "localStorage" ? memoryLocal : memorySession;
    try {
      Object.defineProperty(window, kind, {
        configurable: true,
        enumerable: true,
        get: () => fallback,
      });
      if (typeof console !== "undefined") {
        console.warn(`[trivo] ${kind} is blocked by this WebView — using in-memory fallback.`);
      }
    } catch {
      // Some WebViews mark the property non-configurable; call sites that use
      // safeStorage() below still work, and the raw ones are all try/catched.
    }
  });
}

/** Convenience helpers that never throw, for new call sites. */
export const safeStorage = {
  get(key: string, fallback: string | null = null): string | null {
    try {
      return getStorage().getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string): void {
    try {
      getStorage().setItem(key, value);
    } catch {
      /* best effort */
    }
  },
  remove(key: string): void {
    try {
      getStorage().removeItem(key);
    } catch {
      /* best effort */
    }
  },
  json<T>(key: string, fallback: T): T {
    try {
      const raw = getStorage().getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    try {
      getStorage().setItem(key, JSON.stringify(value));
    } catch {
      /* best effort */
    }
  },
};

/**
 * IndexedDB availability probe. Returns false when the WebView blocks it, so
 * callers can degrade to memory/localStorage instead of throwing on boot.
 */
export async function isIndexedDbAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return false;
  return new Promise<boolean>((resolve) => {
    try {
      const request = indexedDB.open("__trivo_idb_probe__");
      request.onsuccess = () => {
        try {
          request.result.close();
          indexedDB.deleteDatabase("__trivo_idb_probe__");
        } catch {
          /* ignore */
        }
        resolve(true);
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    } catch {
      resolve(false);
    }
  });
}
