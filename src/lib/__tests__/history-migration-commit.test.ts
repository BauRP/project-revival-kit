import { describe, expect, it } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  migrateHistoryMessageRow, migrateHistoryLifecycleRow, HistoryMigrationConflictError,
} from "../history-migration-commit";
import type { StoredMessage, LifecycleRecord } from "../dexie-db";
import type {
  ProtectedMessageRecord, ProtectedLifecycleRecord,
} from "../protected-history-record";

const key = () => importLocalRecordKey(new Uint8Array(32).fill(31));
const message: StoredMessage = {
  id: "m", from: "alice.onion", to: "bob.onion", text: "private",
  timestamp: 42, status: "sent", media: { caption: "private image" },
};
const lifecycle: LifecycleRecord = {
  key: "chat::m", chatKey: "chat", messageId: "m", updatedAt: 45,
  data: { editedText: "secret edit" },
};

describe("crash-safe authenticated history row replacement", () => {
  it("writes sealed data only if the legacy message is still unchanged", async () => {
    const k = await key();
    let stored: StoredMessage | ProtectedMessageRecord = { ...message };
    await migrateHistoryMessageRow(k, message, {
      compareAndReplace: async (expected, prepared) => {
        if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
        stored = prepared;
        return true;
      },
      readCommitted: async () => stored,
    });
    expect("sealed" in stored).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("private image");
  });
  it("refuses stale source edits instead of overwriting the latest message", async () => {
    const k = await key();
    let stored: StoredMessage | ProtectedMessageRecord = {
      ...message, text: "newer edit",
    };
    await expect(migrateHistoryMessageRow(k, message, {
      compareAndReplace: async (expected, prepared) => {
        if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
        stored = prepared;
        return true;
      },
      readCommitted: async () => stored,
    })).rejects.toBeInstanceOf(HistoryMigrationConflictError);
    expect((stored as StoredMessage).text).toBe("newer edit");
  });
  it("rejects an uncommitted or unreadable result without deleting anything", async () => {
    const k = await key();
    await expect(migrateHistoryLifecycleRow(k, lifecycle, {
      compareAndReplace: async () => true,
      readCommitted: async () => undefined,
    })).rejects.toThrow();
  });
  it("authenticates the committed lifecycle and preserves edits", async () => {
    const k = await key();
    let stored: LifecycleRecord | ProtectedLifecycleRecord = lifecycle;
    await migrateHistoryLifecycleRow(k, lifecycle, {
      compareAndReplace: async (_, prepared) => { stored = prepared; return true; },
      readCommitted: async () => stored,
    });
    expect("sealed" in stored).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("secret edit");
  });
});
