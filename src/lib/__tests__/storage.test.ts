import { afterEach, describe, expect, it, vi } from "vitest";
import { dbAddStrict, dbDelete, dbGet, dbGetAll, dbPut } from "../storage";

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
