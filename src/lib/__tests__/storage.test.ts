import { afterEach, describe, expect, it, vi } from "vitest";
import { dbAddStrict, dbDelete, dbDeleteIfUnchangedStrict, dbGet, dbGetAll, dbPut, dbPutIfUnchangedStrict, upgradeLegacyContactsStore } from "../storage";

type MockOperation = "get" | "getAll" | "put" | "add" | "delete";

function fakeDatabase(operation: MockOperation, outcome: "commit" | "abort" | "pending") {
  let transaction: Record<string, unknown> = {};
  let request: Record<string, unknown> = {};
  const close = vi.fn();
  const objectStore = {
    keyPath: null,
    get: vi.fn(() => request),
    getAll: vi.fn(() => request),
    put: vi.fn(() => request),
    add: vi.fn(() => request),
    delete: vi.fn(() => request),
  };
  const database = {
    close,
    transaction: vi.fn(() => {
      transaction = {
        objectStore: vi.fn(() => objectStore),
        error: new Error("transaction aborted by quota/storage failure"),
      };
      return transaction;
    }),
  };
  const open = vi.fn(() => {
    const req: Record<string, unknown> = {};
    queueMicrotask(() => {
      req.result = database;
      (req.onsuccess as (() => void))();
      queueMicrotask(() => {
        if (outcome === "commit") {
          request.result = operation === "getAll" ? [] : operation === "get" ? "saved" : undefined;
          (request.onsuccess as (() => void) | undefined)?.();
          (transaction.oncomplete as (() => void))();
        } else if (outcome === "abort") {
          (transaction.onabort as (() => void))();
        }
      });
    });
    return req;
  });
  vi.stubGlobal("indexedDB", { open });
  return { database, close, objectStore, fireCommit: () => {
    request.result = "saved";
    (request.onsuccess as (() => void) | undefined)?.();
    (transaction.oncomplete as (() => void))();
  }, fireAbort: () => (transaction.onabort as (() => void))() };
}

afterEach(() => vi.unstubAllGlobals());

describe("blocked legacy IndexedDB connection cleanup", () => {
  it("closes a late successful open after already rejecting an onblocked request", async () => {
    const close = vi.fn();
    const db = { close, transaction: vi.fn() };
    const open = vi.fn(() => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        (request.onblocked as () => void)();
        queueMicrotask(() => {
          request.result = db;
          (request.onsuccess as () => void)();
        });
      });
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    await expect(dbGet("settings", "test")).rejects.toThrow("blocked by another open tab");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("legacy v1 contacts schema preservation", () => {
  it("keeps an existing compatible store without recreating or clearing it", () => {
    const store = { keyPath: null, openCursor: vi.fn() };
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(), deleteObjectStore: vi.fn(),
    };
    const tx = { objectStore: vi.fn(() => store) };
    upgradeLegacyContactsStore(db as never, tx as never, 1);
    expect(db.deleteObjectStore).not.toHaveBeenCalled();
    expect(db.createObjectStore).not.toHaveBeenCalled();
    expect(store.openCursor).not.toHaveBeenCalled();
  });
  it("preserves every v1 inline-key contact in the new out-of-line store", () => {
    const records = [
      { key: "friend-1", value: { friendId: "friend-1", name: "Контакт" } },
      { key: "friend-2", value: { friendId: "friend-2", name: "Friend" } },
    ];
    let index = 0;
    const request: Record<string, unknown> = { result: null };
    const cursor = {
      get primaryKey() { return records[index].key; },
      get value() { return records[index].value; },
      continue: vi.fn(() => {
        index += 1;
        request.result = index < records.length ? cursor : null;
        (request.onsuccess as () => void)();
      }),
    };
    request.result = cursor;
    const old = { keyPath: "friendId", openCursor: vi.fn(() => request) };
    const target = { add: vi.fn() };
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(() => target),
      deleteObjectStore: vi.fn(),
    };
    const tx = { objectStore: vi.fn(() => old) };
    upgradeLegacyContactsStore(db as never, tx as never, 1);
    expect(db.deleteObjectStore).not.toHaveBeenCalled();
    (request.onsuccess as () => void)();
    expect(db.deleteObjectStore).toHaveBeenCalledOnce();
    expect(target.add).toHaveBeenNthCalledWith(1, records[0].value, records[0].key);
    expect(target.add).toHaveBeenNthCalledWith(2, records[1].value, records[1].key);
    expect(db.createObjectStore).toHaveBeenCalledWith("contacts");
  });
  it("does not replace contacts when reading the legacy cursor fails", () => {
    const request: Record<string, unknown> = {};
    const old = { keyPath: "friendId", openCursor: vi.fn(() => request) };
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(), deleteObjectStore: vi.fn(),
    };
    const tx = { objectStore: vi.fn(() => old) };
    upgradeLegacyContactsStore(db as never, tx as never, 1);
    // An IndexedDB error aborts the underlying versionchange transaction.
    // The handler must NOT attempt a destructive fallback.
    expect(db.deleteObjectStore).not.toHaveBeenCalled();
    expect(db.createObjectStore).not.toHaveBeenCalled();
  });
});

describe("legacy IndexedDB operations must never signal success before commit", () => {
  it("read and collection handles close their connection on complete", async () => {
    const state = fakeDatabase("get", "commit");
    expect(await dbGet("contacts", "peer")).toBe("saved");
    expect(state.close).toHaveBeenCalledOnce();
    const all = fakeDatabase("getAll", "commit");
    expect(await dbGetAll("contacts")).toEqual([]);
    expect(all.close).toHaveBeenCalledOnce();
  });
  it("keeps write pending until transaction commit", async () => {
    const state = fakeDatabase("put", "pending");
    let resolved = false;
    const writing = dbPut("settings", "key", "secret").then(() => { resolved = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);
    state.fireCommit();
    await writing;
    expect(resolved).toBe(true);
    expect(state.close).toHaveBeenCalledOnce();
  });
  it("propagates aborted writes, deletes and reads instead of hiding errors", async () => {
    for (const [operation, run] of [
      ["put", () => dbPut("settings", "key", "secret")],
      ["delete", () => dbDelete("settings", "key")],
      ["get", () => dbGet("settings", "key")],
      ["getAll", () => dbGetAll("settings")],
    ] as const) {
      const state = fakeDatabase(operation, "abort");
      await expect(run()).rejects.toThrow("transaction aborted");
      expect(state.close).toHaveBeenCalledOnce();
    }
  });
  it("conditionally erases a verified legacy value only after the same-transaction read", async () => {
    const ok = fakeDatabase("get", "commit");
    await dbDeleteIfUnchangedStrict("settings", "legacy", "saved");
    expect(ok.objectStore.get).toHaveBeenCalledWith("legacy");
    expect(ok.objectStore.delete).toHaveBeenCalledWith("legacy");
    expect(ok.close).toHaveBeenCalledOnce();

    const changed = fakeDatabase("get", "commit");
    await expect(dbDeleteIfUnchangedStrict("settings", "legacy", "older"))
      .rejects.toThrow("Legacy profile changed");
    expect(changed.objectStore.delete).not.toHaveBeenCalled();
    expect(changed.close).toHaveBeenCalledOnce();

    const aborted = fakeDatabase("get", "abort");
    await expect(dbDeleteIfUnchangedStrict("settings", "legacy", "saved"))
      .rejects.toThrow("transaction aborted");
    expect(aborted.objectStore.delete).not.toHaveBeenCalled();
    expect(aborted.close).toHaveBeenCalledOnce();
  });
  it("uses atomic compare-and-write to prevent two-tab encrypted profile overwrite", async () => {
    const first = fakeDatabase("get", "commit");
    await dbPutIfUnchangedStrict("settings", "sealed", "saved", { sealed: "edit" });
    expect(first.objectStore.get).toHaveBeenCalledWith("sealed");
    expect(first.objectStore.put).toHaveBeenCalledWith({ sealed: "edit" }, "sealed");
    expect(first.close).toHaveBeenCalledOnce();

    const competing = fakeDatabase("get", "commit");
    await expect(dbPutIfUnchangedStrict("settings", "sealed", "stale", { sealed: "lost" }))
      .rejects.toThrow("Protected profile changed");
    expect(competing.objectStore.put).not.toHaveBeenCalled();
    expect(competing.close).toHaveBeenCalledOnce();

    const aborted = fakeDatabase("get", "abort");
    await expect(dbPutIfUnchangedStrict("settings", "sealed", "saved", { sealed: "edit" }))
      .rejects.toThrow("transaction aborted");
    expect(aborted.objectStore.put).not.toHaveBeenCalled();
    expect(aborted.close).toHaveBeenCalledOnce();
  });
  it("requires an atomic INSERT to succeed without overwriting existing keys", async () => {
    const ok = fakeDatabase("add", "commit");
    await dbAddStrict("settings", "master", { sealed: "encrypted" });
    expect(ok.objectStore.add).toHaveBeenCalledWith({ sealed: "encrypted" }, "master");
    expect(ok.objectStore.put).not.toHaveBeenCalled();
    const fail = fakeDatabase("add", "abort");
    await expect(dbAddStrict("settings", "master", { sealed: "different" })).rejects.toThrow();
    expect(fail.close).toHaveBeenCalledOnce();
  });
});
