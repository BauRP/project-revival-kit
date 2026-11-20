import { describe, expect, it } from "vitest";
import { sameLegacyHistorySnapshot, isMigratableMessageLifecycle } from "../history-migration-dexie";
import type { LifecycleRecord } from "../dexie-db";

describe("Dexie migration conflict and security-row eligibility", () => {
  it("rejects updated bodies, delivery status, metadata or encrypted rows", () => {
    const old = { id: "m", text: "secret", status: "sent", media: { fileId: "f" } };
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ ...old }, old)).toBe(true);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ ...old, text: "edited" }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ ...old, status: "read" }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ ...old, media: { fileId: "g" } }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>(undefined, old)).toBe(false);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ ...old, kind: "trivo-history-message-v1", sealed: {} }, old)).toBe(false);
  });
  it("never migrates deletion, reaction, consumed-file or contact authority rows", () => {
    const edit: LifecycleRecord = {
      key: "peer::m", chatKey: "peer", messageId: "m", updatedAt: 5,
      data: { editedText: "secret edit" },
    };
    expect(isMigratableMessageLifecycle(edit)).toBe(true);
    for (const chatKey of [
      "deleted-message-local", "consumed-media", "reaction::peer",
      "history-protection-local", "removed-contact",
    ]) {
      expect(isMigratableMessageLifecycle({
        ...edit, chatKey, key: `${chatKey}::m`,
      })).toBe(false);
    }
    expect(isMigratableMessageLifecycle({ ...edit, key: "peer::different" })).toBe(false);
  });
  it("does not silently treat different keys or deleted edit mirrors as unchanged", () => {
    const original = { id: "m", text: "secret", extra: undefined };
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({ id: "m", text: "secret", other: undefined },original)).toBe(false);
    const edit: LifecycleRecord = {
      key:"peer::m",chatKey:"peer",messageId:"m",updatedAt:10,data:{isEdited:true},
    };
    expect(isMigratableMessageLifecycle({...edit,data:{deletedForEveryone:true}})).toBe(false);
    expect(isMigratableMessageLifecycle({...edit,data:{deletedFor:["self"]}})).toBe(false);
    expect(isMigratableMessageLifecycle({...edit,messageId:"bad\\nID"})).toBe(false);
  });
  it("accepts equivalent objects with different field order but not missing nested fields", () => {
    const before = { id: "m", text: "safe", media: { fileId: "file", caption: "hello" } };
    const reordered = { media: { caption: "hello", fileId: "file" }, text: "safe", id: "m" };
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>(reordered, before)).toBe(true);
    expect(sameLegacyHistorySnapshot<Record<string, unknown>>({
      ...before, media: { fileId: "file", caption: undefined },
    }, before)).toBe(false);
  });
});
