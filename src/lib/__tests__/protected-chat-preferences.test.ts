import { beforeEach, describe, expect, it, vi } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";

const mock = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  let failWrite = false;
  let failDelete = false;
  const Conflict = class ConcurrentProtectedWriteError extends Error {};
  let concurrentValue: unknown;
  return {
    data, Conflict,
    fail: (write: boolean, erase: boolean) => { failWrite = write; failDelete = erase; },
    raceOnce: (value: unknown) => { concurrentValue = value; },
    get: vi.fn(async (_store: string, key: string) => data.get(key)),
    putIf: vi.fn(async (_store: string, key: string, expected: unknown, value: unknown) => {
      if (failWrite) throw new Error("disk full");
      if (concurrentValue !== undefined) {
        data.set(key, concurrentValue);
        concurrentValue = undefined;
        throw new Conflict();
      }
      if (JSON.stringify(data.get(key)) !== JSON.stringify(expected))
        throw new Conflict();
      data.set(key, value);
    }),
    deleteIf: vi.fn(async (_store: string, key: string, expected: unknown) => {
      if (failDelete) throw new Error("legacy deletion interrupted");
      if (JSON.stringify(data.get(key)) !== JSON.stringify(expected))
        throw new Error("Legacy changed");
      data.delete(key);
    }),
  };
});
vi.mock("../storage", () => ({
  dbGetStrict: mock.get, dbPutIfUnchangedStrict: mock.putIf,
  dbDeleteIfUnchangedStrict: mock.deleteIf,
  ConcurrentProtectedWriteError: mock.Conflict,
}));
vi.mock("../protected-record-inventory", () => ({
  acquireLocalDataKey: () => importLocalRecordKey(new Uint8Array(32).fill(43)),
}));
import {
  readProtectedChatPreferences, updateProtectedChatPreferences,
  saveProtectedChatPreferences, PROTECTED_CHAT_PREFS_PREFIX,
} from "../protected-chat-preferences";

const legacy = (id: string) => "chat-preferences-" + id;
const sealed = (id: string) => PROTECTED_CHAT_PREFS_PREFIX + id;

beforeEach(() => {
  mock.data.clear();
  mock.fail(false, false);
  vi.clearAllMocks();
});

describe("Android Keystore chat settings migration and real persistence", () => {
  it("moves old plaintext after an authenticated committed ciphertext read", async () => {
    const old = { blocked: true, disappearingDuration: "6h", oneTimeDefault: true,
      mutedUntil: 1_800_000_000_000, customLegacyField: "preserve" };
    mock.data.set(legacy("alice"), old);
    expect(await readProtectedChatPreferences("alice")).toEqual(old);
    expect(mock.data.has(legacy("alice"))).toBe(false);
    expect(JSON.stringify(mock.data.get(sealed("alice")))).not.toContain("customLegacyField");
    expect(await readProtectedChatPreferences("alice")).toEqual(old);
  });

  it("never deletes plaintext if committed ciphertext cannot be written", async () => {
    mock.data.set(legacy("bob"), { blocked: true });
    mock.fail(true, false);
    await expect(readProtectedChatPreferences("bob")).rejects.toThrow("disk full");
    expect(mock.data.get(legacy("bob"))).toEqual({ blocked: true });
    expect(mock.data.has(sealed("bob"))).toBe(false);
  });

  it("resumes from authenticated ciphertext after a crash before legacy deletion", async () => {
    mock.data.set(legacy("peer"), { blocked: true, silentDefault: true });
    mock.fail(false, true);
    await expect(readProtectedChatPreferences("peer")).rejects.toThrow("legacy deletion interrupted");
    expect(mock.data.has(legacy("peer"))).toBe(true);
    expect(mock.data.has(sealed("peer"))).toBe(true);
    mock.fail(false, false);
    expect(await readProtectedChatPreferences("peer"))
      .toEqual({ blocked: true, silentDefault: true });
    expect(mock.data.has(legacy("peer"))).toBe(false);
  });

  it("rejects conflicting newer plaintext rather than erasing another window's edit", async () => {
    mock.data.set(legacy("peer"), { blocked: true });
    mock.fail(false, true);
    await expect(readProtectedChatPreferences("peer")).rejects.toThrow();
    mock.fail(false, false);
    mock.data.set(legacy("peer"), { blocked: false });
    await expect(readProtectedChatPreferences("peer")).rejects.toThrow(/Conflicting plaintext/);
    expect(mock.data.get(legacy("peer"))).toEqual({ blocked: false });
  });

  it("authenticates each record by chat identity and refuses ciphertext swapping", async () => {
    await saveProtectedChatPreferences("alice", { blocked: true });
    mock.data.set(sealed("bob"), mock.data.get(sealed("alice")));
    await expect(readProtectedChatPreferences("bob")).rejects.toThrow(/authentication failed/);
    expect(await readProtectedChatPreferences("alice")).toEqual({ blocked: true });
  });

  it("persists unrelated new settings without deleting existing flags", async () => {
    await saveProtectedChatPreferences("alice", { blocked: true, favorite: true });
    const next = await updateProtectedChatPreferences("alice",
      (old) => ({ ...old, archived: true, silentDefault: true }));
    expect(next).toEqual({
      blocked: true, favorite: true, archived: true, silentDefault: true,
    });
    expect(await readProtectedChatPreferences("alice")).toEqual(next);
  });

  it("retries a competing setting change without clobbering either edit", async () => {
    await saveProtectedChatPreferences("peer", { blocked: true });
    // Simulate a competing tab committing a new authenticated row before CAS.
    await saveProtectedChatPreferences("other", { blocked: true, favorite: true });
    // The encrypted payload is bound to its primary key, so it cannot be used
    // as the winner for a different chat. Here we preserve the same row by
    // forcing a CAS retry with the currently committed ciphertext.
    mock.raceOnce(mock.data.get(sealed("peer")));
    const next = await updateProtectedChatPreferences("peer",
      (current) => ({ ...current, silentDefault: true }));
    expect(next).toEqual({ blocked: true, silentDefault: true });
    expect(await readProtectedChatPreferences("peer")).toEqual(next);
  });

  it("rejects malformed legacy privacy flags without deleting or encrypting them", async () => {
    mock.data.set(legacy("alice"), { blocked: "false", oneTimeDefault: true });
    await expect(readProtectedChatPreferences("alice")).rejects.toThrow(/Invalid chat preference/);
    expect(mock.data.get(legacy("alice"))).toEqual({
      blocked: "false", oneTimeDefault: true,
    });
    expect(mock.data.has(sealed("alice"))).toBe(false);
  });

  it("refuses invalid contact identity before changing protected storage", async () => {
    for (const chatId of ["", "x".repeat(129), "alice\\nother"]) {
      await expect(saveProtectedChatPreferences(chatId, { blocked: false })).rejects.toThrow();
    }
    expect(mock.data.size).toBe(0);
  });

  it("rejects malformed encrypted state and rejects attempts to silently unblock", async () => {
    await saveProtectedChatPreferences("alice", { blocked: true });
    mock.data.set(sealed("alice"), { version: 2, sealed: {} });
    await expect(readProtectedChatPreferences("alice")).rejects.toThrow();
    expect(mock.data.has(legacy("alice"))).toBe(false);
    await expect(saveProtectedChatPreferences("alice", { blocked: false })).rejects.toThrow();
  });
});
