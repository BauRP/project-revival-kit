// IndexedDB wrapper for Trivo Chat local-only storage

const DB_NAME = "trivo-chat";
const DB_VERSION = 2;

/**
 * v1 stored contacts with an inline keyPath; v2 needs an out-of-line key.
 * Previously the upgrader deleted the whole v1 contacts store, destroying
 * every contact during the first APK update. Preserve keys and values within
 * the SAME versionchange transaction. Any failed cursor/write aborts upgrade.
 */
export function upgradeLegacyContactsStore(
  db: IDBDatabase, transaction: IDBTransaction, oldVersion: number,
): void {
  if (oldVersion >= 2) return;
  if (!db.objectStoreNames.contains("contacts")) {
    db.createObjectStore("contacts");
    return;
  }
  const original = transaction.objectStore("contacts");
  if (original.keyPath === null) return; // Already compatible. Never delete.
  const existing: { key: IDBValidKey; value: unknown }[] = [];
  const cursorRequest = original.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      existing.push({ key: cursor.primaryKey, value: cursor.value });
      cursor.continue();
      return;
    }
    // The cursor is exhausted; all original records were read successfully.
    // The upgrade transaction is still active in this request callback.
    db.deleteObjectStore("contacts");
    const upgraded = db.createObjectStore("contacts");
    for (const row of existing) upgraded.add(row.value, row.key);
  };
  // An IDBRequest error aborts the upgrade transaction by default. Do not
  // swallow it or try to recreate an empty contacts store on corruption.
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains("identity")) db.createObjectStore("identity");
        if (!db.objectStoreNames.contains("messages"))
          db.createObjectStore("messages", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      }

      // v2: switch contacts to explicit keys WITHOUT erasing old contacts.
      upgradeLegacyContactsStore(db, req.transaction!, oldVersion);
    };
    req.onsuccess = () => {
      // A stale tab must release old DB connections when a later APK needs
      // a schema version upgrade. Otherwise IndexedDB.open can hang forever.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error || new Error("Cannot open local database"));
    req.onblocked = () => reject(new Error("Local database is blocked by another open tab"));
  });
}

/** Critical identity operations must never convert a storage failure to a missing key. */
export async function dbGetStrict<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    let result: T | undefined;
    try {
      const transaction = db.transaction(store, "readonly");
      const request = transaction.objectStore(store).get(key);
      request.onsuccess = () => { result = request.result as T | undefined; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Identity read failed")); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Identity read aborted")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function dbPutStrict(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const transaction = db.transaction(store, "readwrite");
      const target = transaction.objectStore(store);
      if (target.keyPath) target.put(value);
      else target.put(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Identity write failed")); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Identity write aborted")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/**
 * Non-critical UI callers historically treated quota/abort errors as a
 * successful save or a missing key. This is unsafe for identity migration,
 * private notes and contacts: all callers now observe transaction failure.
 * The strict operations close each IDB connection on commit or abort.
 */
export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  return dbGetStrict<T>(store, key);
}

export async function dbPut(store: string, key: string, value: unknown): Promise<void> {
  return dbPutStrict(store, key, value);
}

/**
 * Reserve a protected setting exactly once. Never allow concurrent startup
 * instances to replace a previous Keystore-wrapped data encryption key.
 * ConstraintError is propagated; the caller must re-read the winning key.
 */
export async function dbAddStrict(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const transaction = db.transaction(store, "readwrite");
      const target = transaction.objectStore(store);
      if (target.keyPath) target.add(value);
      else target.add(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Atomic storage insert failed"));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error("Atomic storage insert aborted"));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/** Count without copying sensitive records into JS memory on identity recovery. */
export async function dbCountStrict(store: string): Promise<number> {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    let result = 0;
    try {
      const transaction = db.transaction(store, "readonly");
      const request = transaction.objectStore(store).count();
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Count failed")); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Count aborted")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/** Remove legacy plaintext after verifying its Dexie migration committed.
 * A failed transaction must never be treated as successful erasure. */
export async function dbClearStrict(store: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const transaction = db.transaction(store, "readwrite");
      transaction.objectStore(store).clear();
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Legacy erasure failed")); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Legacy erasure aborted")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/** Use for migrations: storage failures must never turn into an empty result. */
export async function dbGetAllStrict<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise<T[]>((resolve, reject) => {
    let result: T[] = [];
    try {
      const transaction = db.transaction(store, "readonly");
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => { result = request.result as T[]; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Migration read failed")); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Migration read aborted")); };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  return dbGetAllStrict<T>(store);
}

/** A deleted key is gone only after IDBTransaction.oncomplete, not at request success. */
export async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB deletion failed"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB deletion aborted"));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}


/**
 * Atomically compare and update a settings record. Without this guard two
 * WebViews/tabs can both read the same ciphertext, encrypt different edits
 * and silently overwrite the first committed profile.
 *
 * The comparison and write run in a single IndexedDB readwrite transaction.
 * A mismatch is a conflict; it never becomes a successful save.
 */
export async function dbPutIfUnchangedStrict(
  store: string, key: string, expected: unknown, value: unknown,
): Promise<void> {
  const expectedJson = JSON.stringify(expected);
  if (expected !== undefined && expectedJson === undefined)
    throw new Error("Invalid expected protected record");
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    let conflict = false;
    try {
      const tx = db.transaction(store, "readwrite");
      const target = tx.objectStore(store);
      const req = target.get(key);
      req.onsuccess = () => {
        if (JSON.stringify(req.result) !== expectedJson) {
          conflict = true;
          return;
        }
        if (target.keyPath) target.put(value);
        else target.put(value, key);
      };
      tx.oncomplete = () => {
        db.close();
        if (conflict) reject(new Error("Protected profile changed in another session"));
        else resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Conditional protected write failed"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("Conditional protected write aborted"));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/**
 * Delete a legacy profile only if it still contains the exact value verified
 * by the encrypted-profile migration. Compare and delete inside ONE IDB
 * readwrite transaction so another tab cannot replace it between operations.
 * A changed/missing value is a conflict, never a successful migration.
 */
export async function dbDeleteIfUnchangedStrict(
  store: string, key: string, expected: unknown,
): Promise<void> {
  const expectedJson = JSON.stringify(expected);
  if (expectedJson === undefined) throw new Error("Invalid legacy record to erase");
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    let conflict = false;
    try {
      const tx = db.transaction(store, "readwrite");
      const target = tx.objectStore(store);
      const request = target.get(key);
      request.onsuccess = () => {
        if (JSON.stringify(request.result) !== expectedJson) {
          conflict = true;
          return;
        }
        target.delete(key);
      };
      tx.oncomplete = () => {
        db.close();
        if (conflict) reject(new Error("Legacy profile changed during encrypted migration"));
        else resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Conditional legacy deletion failed"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("Conditional legacy deletion aborted"));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/** Delete each database after closing active Dexie connections. */
function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error(`Cannot delete ${name}`));
    req.onblocked = () => reject(new Error(`Database ${name} is still open`));
  });
}

export async function nukeAllData(): Promise<void> {
  // Never claim success when the database is locked or deletion failed.
  const [{ dxdb }, { closeScheduledOutbox }] = await Promise.all([import("./dexie-db"), import("./outbox")]);
  await closeScheduledOutbox();
  dxdb.close();
  await dxdb.delete();
  await deleteIndexedDb(DB_NAME);
  await deleteIndexedDb("trivo-outbox");
  const { forgetCachedLocalDataKey } = await import("./protected-record-inventory");
  forgetCachedLocalDataKey();
  localStorage.clear();
  sessionStorage.clear();
}
