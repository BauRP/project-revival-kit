import { describe, expect, it } from "vitest";
import { sameLegacyHistorySnapshot, isMigratableMessageLifecycle } from "../history-migration-dexie";
import type { LifecycleRecord } from "../dexie-db";

describe("Dexie migration conflict and security-row eligibility", () => {
  it("rejects updated bodies, delivery status, metadata or encrypted rows", () => {
    const old = { id: "m", text: "secret", status: "sent", media: { fileId: "f" } };
    expect(sameLegacyHistorySnapshot({ ...old }, old)).toBe(true);
    expect(sameLegacyHistorySnapshot({ ...old, text: "edited" }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot({ ...old, status: "read" }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot({ ...old, media: { fileId: "g" } }, old)).toBe(false);
    expect(sameLegacyHistorySnapshot(undefined, old)).toBe(false);
    expect(sameLegacyHistorySnapshot({ ...old, kind: "trivo-history-message-v1", sealed: {} }, old)).toBe(false);
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
});
