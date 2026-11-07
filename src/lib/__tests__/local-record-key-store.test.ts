import { describe, expect, it, vi } from "vitest";
import {
  acquireProtectedStorageKey, parsePersistedLocalKey,
} from "../local-record-key-store";

const sealed = (label: string) => ({ version: 1 as const, wrapped: label + "-ciphertext" });

describe("Keystore master key one-time durable bootstrap", () => {
  it("opens existing wrapped key without ever generating another", async () => {
    const create = vi.fn(async () => ({ key: "new", wrapped: "new-ciphertext" }));
    const ready = await acquireProtectedStorageKey({
      read: async () => sealed("old"),
      insert: vi.fn(async () => undefined),
      create, open: async (value) => value,
      isProtectedStoreEmpty: vi.fn(async () => false),
    });
    expect(ready).toBe("old-ciphertext");
    expect(create).not.toHaveBeenCalled();
  });
  it("persists wrapped material before returning its in-memory key", async () => {
    const steps: string[] = [];
    const key = await acquireProtectedStorageKey({
      read: async () => undefined,
      isProtectedStoreEmpty: async () => true,
      create: async () => { steps.push("create"); return { key: "ephemeral", wrapped: "private-ciphertext" }; },
      insert: async (record) => { steps.push("committed:" + record.wrapped); },
      open: async () => { throw new Error("not expected"); },
    });
    expect(key).toBe("ephemeral");
    expect(steps).toEqual(["create", "committed:private-ciphertext"]);
  });
  it("never regenerates a lost key if protected data is present", async () => {
    const create = vi.fn(async () => ({ key: "bad", wrapped: "new-ciphertext" }));
    await expect(acquireProtectedStorageKey({
      read: async () => undefined,
      isProtectedStoreEmpty: async () => false,
      create, insert: async () => undefined, open: async () => "bad",
    })).rejects.toThrow("Protected messages exist");
    expect(create).not.toHaveBeenCalled();
  });
  it("after concurrent insert collision opens winner instead of using discarded key", async () => {
    let reads = 0;
    const value = await acquireProtectedStorageKey({
      read: async () => (++reads === 1 ? undefined : sealed("winner")),
      isProtectedStoreEmpty: async () => true,
      create: async () => ({ key: "loser", wrapped: "loser-ciphertext" }),
      insert: async () => { throw new Error("ConstraintError"); },
      open: async (wrapped) => "opened:" + wrapped,
    });
    expect(value).toBe("opened:winner-ciphertext");
  });
  it("fails closed on malformed or unreadable key and lost durable insert", async () => {
    expect(() => parsePersistedLocalKey({ version: 1, wrapped: "" })).toThrow();
    await expect(acquireProtectedStorageKey({
      read: async () => { throw new Error("IndexedDB temporarily unavailable"); },
      isProtectedStoreEmpty: async () => true,
      create: async () => ({ key: "bad", wrapped: "new-ciphertext" }),
      insert: async () => undefined, open: async () => "bad",
    })).rejects.toThrow("IndexedDB temporarily unavailable");
    await expect(acquireProtectedStorageKey({
      read: async () => undefined,
      isProtectedStoreEmpty: async () => true,
      create: async () => ({ key: "bad", wrapped: "new-ciphertext" }),
      insert: async () => { throw new Error("disk full"); },
      open: async () => "bad",
    })).rejects.toThrow("disk full");
  });
});
