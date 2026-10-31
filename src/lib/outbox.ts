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
}

type Sender = (item: ScheduledItem) => Promise<void> | void;

let dbPromise: Promise<IDBDatabase> | null = null;
const senders = new Map<string, Sender>(); // chatId → sender
let timer: ReturnType<typeof setTimeout> | null = null;

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
    req.onerror = () => reject(req.error);
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
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listOutbox(): Promise<ScheduledItem[]> {
  try {
    const all = await tx<ScheduledItem[]>(
      "readonly",
      (s) => s.getAll() as IDBRequest<ScheduledItem[]>,
    );
    return all.sort((a, b) => a.scheduledAt - b.scheduledAt);
  } catch {
    return [];
  }
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
  await tx("readwrite", (s) => s.put(full));
  scheduleNextWake();
  return full;
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export function registerSender(chatId: string, send: Sender): () => void {
  senders.set(chatId, send);
  scheduleNextWake();
  return () => {
    if (senders.get(chatId) === send) senders.delete(chatId);
  };
}

async function fireDue() {
  timer = null;
  const now = Date.now();
  const items = await listOutbox();
  for (const item of items) {
    if (item.scheduledAt > now) break;
    const sender = senders.get(item.chatId);
    if (!sender) continue; // chat not open — wait for next mount
    try {
      await sender(item);
      await remove(item.id);
    } catch (e) {
      console.error("[outbox] send failed", item.id, e);
      // Update the SAME persisted item without deleting it. A failed send
      // must never erase an offline message from the queue.
      const attempts = (item.attempts ?? 0) + 1;
      const retryDelay = Math.min(30_000 * 2 ** Math.min(attempts - 1, 7), 60 * 60_000);
      await tx("readwrite", (store) =>
        store.put({ ...item, attempts, scheduledAt: Date.now() + retryDelay }),
      );
    }
  }
  scheduleNextWake();
}

function scheduleNextWake() {
  if (typeof window === "undefined") return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void listOutbox().then((items) => {
    if (!items.length) return;
    const next = items[0];
    const delay = Math.max(0, next.scheduledAt - Date.now());
    // Cap at 60s so we re-evaluate periodically (handles registerSender races).
    timer = setTimeout(fireDue, Math.min(delay, 60_000));
  });
}

// Kick off on import so a reload picks up persisted items.
if (typeof window !== "undefined") {
  scheduleNextWake();
}
