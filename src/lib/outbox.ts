import { nextScheduledRetry, nextBlockedScheduledCheck, scheduledWakeAt, validateScheduledItem, validateStoredScheduledItem, sameScheduledState, canScheduleRecipient, retainDueScheduled } from "./scheduled-policy";
import { protectScheduledText, revealScheduledText, isSealedScheduledText } from "./scheduled-encryption";
import { isNative } from "./platform";
import { getChatPreferences, chatAllowsOutbound } from "./chat-preferences";
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
  // IndexedDB may remain blocked while another WebView has an older schema.
  // Fail visibly instead of leaving Scheduled Send stuck on a never-settling
  // promise, and invalidate a connection closed by an external upgrade.
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byScheduledAt", "scheduledAt");
      }
    };
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return; }
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === pending) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      if (dbPromise === pending) dbPromise = null;
      reject(req.error || new Error("Cannot open scheduled outbox"));
    };
    req.onblocked = () => {
      blocked = true;
      if (dbPromise === pending) dbPromise = null;
      reject(new Error("Scheduled outbox is blocked by another app window"));
    };
  });
  dbPromise = pending;
  return pending;
}

/** Find the next wake without materializing every encrypted scheduled message.
 * The expensive full list is still available for user-visible queue browsing
 * and actual due-message processing.
 */
async function nextScheduledWake(): Promise<number | null> {
  const db = await openDB();
  return new Promise<number | null>((resolve, reject) => {
    let earliest = Number.POSITIVE_INFINITY;
    let validationError: unknown;
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      try {
        const item = cursor.value as ScheduledItem;
        validateStoredScheduledItem(item, isSealedScheduledText(item.text));
        earliest = Math.min(earliest, scheduledWakeAt(item));
        cursor.continue();
      } catch (error) {
        validationError = error;
        t.abort();
      }
    };
    req.onerror = () => { validationError = req.error; };
    t.oncomplete = () => resolve(Number.isFinite(earliest) ? earliest : null);
    t.onerror = () => reject(validationError ?? t.error ?? new Error("Cannot read scheduled wake"));
    t.onabort = () => reject(validationError ?? t.error ?? new Error("Scheduled wake aborted"));
  });
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

/** Compare and mutate in ONE IndexedDB write transaction. A serialized
 * JavaScript mutex cannot protect another WebView/process. In particular,
 * encrypting legacy text must not recreate a schedule deleted by a peer
 * window, and a late send/retry must not erase a replacement under its ID.
 * No network or Keystore promises are awaited inside the transaction.
 */
async function updateScheduledIfCurrent(
  expected: ScheduledItem,
  apply: (store: IDBObjectStore, current: ScheduledItem) => void,
): Promise<boolean> {
  const db = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, "readwrite");
    } catch (error) {
      reject(error);
      return;
    }
    const store = tx.objectStore(STORE);
    let changed = false;
    let cause: unknown;
    const req = store.get(expected.id) as IDBRequest<ScheduledItem | undefined>;
    req.onsuccess = () => {
      if (!sameScheduledState(expected, req.result)) return;
      try {
        apply(store, req.result!);
        changed = true;
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    req.onerror = () => { cause = req.error; };
    tx.oncomplete = () => resolve(changed);
    tx.onerror = () => reject(cause ?? tx.error ?? new Error("Scheduled update failed"));
    tx.onabort = () => reject(cause ?? tx.error ?? new Error("Scheduled update aborted"));
  });
}

/** Enumerate only primary keys of legacy plaintext scheduled messages.
 * No full getAll/listOutbox of possibly huge protected text envelopes.
 * The actual row is fetched again and CAS-checked before sealing.
 */
async function legacyScheduledKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise<string[]>((resolve, reject) => {
    const keys: string[] = [];
    let failure: unknown;
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try {
        const row = cursor.value as ScheduledItem;
        const encrypted = isSealedScheduledText(row.text);
        validateStoredScheduledItem(row, encrypted);
        if (!encrypted) keys.push(row.id);
        cursor.continue();
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    request.onerror = () => { failure = request.error; };
    transaction.oncomplete = () => resolve(keys);
    transaction.onerror = () => reject(failure ?? transaction.error ??
      new Error("Unable to enumerate scheduled migration keys"));
    transaction.onabort = () => reject(failure ?? transaction.error ??
      new Error("Scheduled migration key scan aborted"));
  });
}

/** Keystore migration may race an old WebView writing a legacy plaintext
 * schedule. Check the committed store without copying all queued texts into
 * JS memory before declaring Android's schedule migration complete.
 */
async function assertAllScheduledTextsProtected(): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    let failure: unknown;
    let foundPlaintext = false;
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try {
        const item = cursor.value as ScheduledItem;
        const protectedText = isSealedScheduledText(item.text);
        validateStoredScheduledItem(item, protectedText);
        if (!protectedText) {
          foundPlaintext = true;
          return;
        }
        cursor.continue();
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    request.onerror = () => { failure = request.error; };
    transaction.oncomplete = () => foundPlaintext
      ? reject(new Error("Scheduled Android queue still contains legacy plaintext"))
      : resolve();
    transaction.onerror = () => reject(failure ?? transaction.error ?? new Error("Cannot inspect scheduled queue"));
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Scheduled queue scan aborted"));
  });
}

/** Identity bootstrap/recovery needs only occupancy, not private text.
 * A single native IndexedDB count avoids materializing the whole queue.
 * Read errors propagate: failure is never mistaken for an empty queue.
 */
export async function countScheduledOutbox(): Promise<number> {
  return tx<number>("readonly", (store) => store.count());
}

export async function listOutbox(): Promise<ScheduledItem[]> {
  // A failed read is not an empty queue. Propagate the error to prevent
  // falsely reporting that scheduled messages were delivered or deleted.
  const all = await tx<ScheduledItem[]>(
    "readonly",
    (store) => store.getAll() as IDBRequest<ScheduledItem[]>,
  );
  // Corrupt old retry metadata must never turn into NaN → setTimeout(0)
  // and a continuous background wake loop. Keep invalid rows on disk so
  // they can be recovered rather than treating them as sent/deleted.
  for (const item of all) {
    validateStoredScheduledItem(item, isSealedScheduledText(item.text));
  }
  return all.sort((a, b) => scheduledWakeAt(a) - scheduledWakeAt(b));
}

/** Read only a bounded number of due schedules for delivery.
 * The user-facing listOutbox() still returns the complete queue, but each
 * background wake keeps at most 64 potentially large ciphertext rows in RAM.
 * We scan every row so retry timestamps (not just the scheduledAt index)
 * determine which entries are actually due.
 */
async function dueScheduledBatch(now: number, limit = 64): Promise<ScheduledItem[]> {
  const db = await openDB();
  return new Promise<ScheduledItem[]>((resolve, reject) => {
    const due: ScheduledItem[] = [];
    let failure: unknown;
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try {
        const item = cursor.value as ScheduledItem;
        validateStoredScheduledItem(item, isSealedScheduledText(item.text));
        retainDueScheduled(due, item, now, limit);
        cursor.continue();
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    request.onerror = () => { failure = request.error; };
    transaction.oncomplete = () => resolve(due);
    transaction.onerror = () => reject(failure ?? transaction.error ??
      new Error("Cannot read due scheduled messages"));
    transaction.onabort = () => reject(failure ?? transaction.error ??
      new Error("Due scheduled scan aborted"));
  });
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
  const items = await dueScheduledBatch(now);
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
        if (!current || !sameScheduledState(item, current)) return;
        // A legacy WebView or interrupted migration can leave a new plaintext
        // entry after startup. Do not dispatch it or treat migration as done.
        if (isNative() && !isSealedScheduledText(current.text)) {
          scheduledMigrationReady = false;
          void Promise.resolve().then(initializeScheduledOutbox);
          throw new Error("Scheduled message requires Android Keystore migration");
        }
        // The recipient may have been blocked after this schedule was saved.
        // Keep the durable schedule for future unblocking; do not dispatch it
        // to either a mounted sender or the fallback P2P path.
        if (!chatAllowsOutbound(await getChatPreferences(current.chatId))) {
          // A block is not a network failure. Preserve retry attempts and
          // keep the durable encrypted item available after unblocking.
          await updateScheduledIfCurrent(current, (store, latest) => {
            store.put(nextBlockedScheduledCheck(latest, Date.now()));
          });
          return;
        }
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
        await updateScheduledIfCurrent(current, (store) => {
          store.delete(current.id);
        });
      });
    } catch (e) {
      console.error("[outbox] send failed", item.id, e);
      // Retain the same immutable identity; never resurrect an item cancelled
      // during an async send or replace a newly scheduled item with old data.
      await serialized(async () => {
        if (closed) return;
        await updateScheduledIfCurrent(item, (store, current) => {
          store.put(nextScheduledRetry(current, Date.now()));
        });
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
  void nextScheduledWake().then((wake) => {
    if (generation !== wakeGeneration || wake === null) return;
    const delay = Math.max(0, wake - Date.now());
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
    for (const key of await legacyScheduledKeys()) {
      // Another WebView may cancel or encrypt this entry after the cursor
      // closed. Do not recreate it, and never overwrite the replacement.
      const item = await tx<ScheduledItem | undefined>(
        "readonly",
        (store) => store.get(key) as IDBRequest<ScheduledItem | undefined>,
      );
      if (!item || isSealedScheduledText(item.text)) continue;
      validateStoredScheduledItem(item, false);
      const sealed = await protectScheduledText(item.text);
      const migrated = await updateScheduledIfCurrent(item, (store, current) => {
        store.put({ ...current, text: sealed });
      });
      if (!migrated)
        throw new Error("Scheduled message changed during Keystore migration; retry required");
      changed++;
    }
    await assertAllScheduledTextsProtected();
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
