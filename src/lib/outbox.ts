import { nextScheduledRetry, scheduledWakeAt, validateScheduledItem, sameScheduledIdentity, canScheduleRecipient } from "./scheduled-policy";
import { protectScheduledText, revealScheduledText, isSealedScheduledText } from "./scheduled-encryption";
import { isNative } from "./platform";
// Local outbox for Scheduled Send (Turn 2).
//
// Persists pending messages in IndexedDB so a page reload doesn't lose them.
// A single in-process timer wakes up to fire due items via the registered
// sender. Native Android WorkManager parity is documented as a TODO in
// legacy/android/ — this module is the web-layer source of truth.
//
// Decoupled from ChatRoom: ChatRoom registers a sender at mount, enqueues
// items, and gets fire-time callbacks. No backend coupling here; the sender
// itself decides how to actually deliver (P2P / Tor / etc.).

const DB_NAME = "trivo-outbox";
const STORE = "scheduled";
const VERSION = 1;

export interface ScheduledItem {
  id: string;
  chatId: string;
  text: string;
  silent: boolean;
  scheduledAt: number; // epoch ms
  createdAt: number;
  attempts?: number; // retained across retries; never reset the scheduled item
  nextAttemptAt?: number; // separate from immutable scheduledAt
}

type Sender = (item: ScheduledItem) => Promise<void> | void;

let dbPromise: Promise<IDBDatabase> | null = null;
const senders = new Map<string, Sender>(); // chatId → sender
let timer: ReturnType<typeof setTimeout> | null = null;
let wakeGeneration = 0;
let closed = false;
let scheduledMigrationReady = !isNative();
let migrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
let foregroundHandler: (() => void) | null = null;
// All fire/cancel operations in the same WebView serialize through this mutex.
let mutationTail: Promise<void> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work, work);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byScheduledAt", "scheduledAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result: T;
    try {
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => t.abort();
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error("Scheduled outbox transaction failed"));
      t.onabort = () => reject(t.error || new Error("Scheduled outbox transaction aborted"));
    } catch (error) {
      t.abort();
      reject(error);
    }
  });
}

export async function listOutbox(): Promise<ScheduledItem[]> {
  // A failed read is not an empty queue. Propagate the error to prevent
  // falsely reporting that scheduled messages were delivered or deleted.
  const all = await tx<ScheduledItem[]>(
    "readonly",
    (store) => store.getAll() as IDBRequest<ScheduledItem[]>,
  );
  return all.sort((a, b) => scheduledWakeAt(a) - scheduledWakeAt(b));
}

export async function enqueue(
  item: Omit<ScheduledItem, "id" | "createdAt"> & { id?: string },
): Promise<ScheduledItem> {
  const full: ScheduledItem = {
    id: item.id ?? `out_${crypto.randomUUID()}`,
    chatId: item.chatId,
    text: item.text,
    silent: item.silent,
    scheduledAt: item.scheduledAt,
    createdAt: Date.now(),
    attempts: 0,
  };
  validateScheduledItem(full);
  if (!canScheduleRecipient(full.chatId))
    throw new Error("Cannot schedule: recipient must be a valid Tor onion address");
  if (closed) throw new Error("Scheduled outbox is closed");
  // Never persist unencrypted text on Android. A Keystore failure aborts
  // enqueue rather than quietly saving a plaintext fallback.
  await serialized(async () => {
    const persisted: ScheduledItem = { ...full, text: await protectScheduledText(full.text) };
    await tx("readwrite", (s) => s.add(persisted));
  });
  scheduleNextWake();
  return full;
}

export async function remove(id: string): Promise<void> {
  if (closed) throw new Error("Scheduled outbox is closed");
  await serialized(() => tx("readwrite", (s) => s.delete(id)));
  scheduleNextWake();
}

export function registerSender(chatId: string, send: Sender): () => void {
  senders.set(chatId, send);
  scheduleNextWake();
  return () => {
    if (senders.get(chatId) === send) senders.delete(chatId);
    scheduleNextWake();
  };
}

let firingDue = false;
async function fireDue() {
  // Do not dispatch legacy plaintext until Android Keystore has secured all
  // queued messages. An unavailable Keystore means retry, not lost messages.
  if (firingDue || closed || !scheduledMigrationReady) return;
  firingDue = true;
  timer = null;
  try {
  const now = Date.now();
  const items = await listOutbox();
  for (const item of items) {
    if (closed) break;
    if (scheduledWakeAt(item) > now) break;
    try {
      await serialized(async () => {
        if (closed) return;
        // A user may have cancelled this schedule after listOutbox().
        const current = await tx<ScheduledItem | undefined>(
          "readonly", (store) => store.get(item.id) as IDBRequest<ScheduledItem | undefined>,
        );
        if (!current || !sameScheduledIdentity(item, current)) return;
        const decrypted = await revealScheduledText(current.text);
        const dispatch: ScheduledItem = { ...current, text: decrypted };
        validateScheduledItem(dispatch);
        const sender = senders.get(current.chatId);
        if (sender) {
          await sender(dispatch);
        } else {
        // The scheduled message must not depend on the chat screen being open.
        // The onion outbox becomes the durable owner after sendP2PMessage.
        const [{ ensureLocalIdentity }, { sendP2PMessage }] = await Promise.all([
          import("./onion-engine"), import("./p2p"),
        ]);
        if (!canScheduleRecipient(item.chatId))
          throw new Error("Scheduled recipient is not a valid Tor address");
        const self = await ensureLocalIdentity();
        await sendP2PMessage(dispatch.chatId, {
          id: dispatch.id,
          from: self,
          to: dispatch.chatId,
          text: dispatch.text,
          timestamp: dispatch.scheduledAt,
          status: "pending",
          silent: dispatch.silent,
        });
      }
        await tx("readwrite", (store) => store.delete(item.id));
      });
    } catch (e) {
      console.error("[outbox] send failed", item.id, e);
      // Retain the same immutable identity; never resurrect an item cancelled
      // during an async send or replace a newly scheduled item with old data.
      await serialized(async () => {
        if (closed) return;
        const current = await tx<ScheduledItem | undefined>(
          "readonly", (store) => store.get(item.id) as IDBRequest<ScheduledItem | undefined>,
        );
        if (sameScheduledIdentity(item, current))
          await tx("readwrite", (store) =>
            store.put(nextScheduledRetry(current!, Date.now())),
          );
      });
    }
  }
  } finally {
    firingDue = false;
    scheduleNextWake();
  }
}

function scheduleNextWake() {
  if (typeof window === "undefined" || closed || !scheduledMigrationReady) return;
  const generation = ++wakeGeneration;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void listOutbox().then((items) => {
    if (generation !== wakeGeneration || !items.length) return;
    const next = items[0];
    const delay = Math.max(0, scheduledWakeAt(next) - Date.now());
    // Cap at 60s so we re-evaluate periodically (handles registerSender races).
    timer = setTimeout(() => void fireDue().catch((error) => {
      console.error("[outbox] scheduled delivery failed", error);
      scheduleNextWake();
    }), Math.min(delay, 60_000));
  }).catch((error) => {
    if (generation !== wakeGeneration) return;
    console.error("[outbox] unable to read pending messages", error);
    timer = setTimeout(scheduleNextWake, 30_000);
  });
}

/** Release the scheduled IndexedDB connection before a full account wipe. */
export async function closeScheduledOutbox(): Promise<void> {
  closed = true;
  ++wakeGeneration; // invalidate asynchronous wake planners during account wipe
  if (timer) { clearTimeout(timer); timer = null; }
  if (migrationRetryTimer) { clearTimeout(migrationRetryTimer); migrationRetryTimer = null; }
  if (foregroundHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", foregroundHandler);
    foregroundHandler = null;
  }
  senders.clear();
  // All in-flight sends and retries finish before the connection is closed.
  await mutationTail;
  const pending = dbPromise;
  dbPromise = null;
  if (pending) {
    const db = await pending;
    db.close();
  }
}

/**
 * Transparently upgrade plaintext scheduled messages from older Android builds.
 * Keep the original id/time so the encrypted Tor outbox can de-duplicate.
 * Never delete data after a Keystore failure: retain the legacy item and
 * report the failure so the next startup can retry migration.
 */
export async function migrateLegacyScheduledTexts(): Promise<number> {
  if (!isNative()) return 0;
  return serialized(async () => {
    let changed = 0;
    for (const item of await listOutbox()) {
      if (isSealedScheduledText(item.text)) continue;
      validateScheduledItem(item);
      const sealed = await protectScheduledText(item.text);
      await tx("readwrite", (store) => store.put({ ...item, text: sealed }));
      changed++;
    }
    return changed;
  });
}

// Never allow an existing plaintext queued message to fire while the
// Keystore migration is pending. A failed migration retries without deleting.
function initializeScheduledOutbox(): void {
  if (closed) return;
  void migrateLegacyScheduledTexts().then(() => {
    if (closed) return;
    scheduledMigrationReady = true;
    migrationRetryTimer = null;
    scheduleNextWake();
  }).catch((error) => {
    console.error("[outbox] scheduled text migration unavailable; pending messages retained", error);
    if (!closed && typeof window !== "undefined")
      migrationRetryTimer = setTimeout(initializeScheduledOutbox, 30_000);
  });
}
if (typeof window !== "undefined") {
  initializeScheduledOutbox();
  // Android may suspend timers when the WebView is backgrounded. Recover
  // overdue scheduled messages immediately upon returning to the foreground.
  foregroundHandler = () => {
    if (closed || document.hidden) return;
    scheduleNextWake();
    void fireDue().catch((error) =>
      console.error("[outbox] unable to resume due messages", error));
  };
  document.addEventListener("visibilitychange", foregroundHandler);
}
