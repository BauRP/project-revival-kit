import { describe, expect, it } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  SEALED_MESSAGE_KIND, SEALED_LIFECYCLE_KIND,
  sealHistoryMessage, openHistoryMessage, sealHistoryLifecycle,
  openHistoryLifecycle, parseProtectedMessageRow, parseProtectedLifecycleRow,
  looksLikeProtectedHistoryRow,
} from "../protected-history-record";

const key = (n: number) => importLocalRecordKey(new Uint8Array(32).fill(n));
const message = {
  id: "m-1", from: "sender.onion", to: "recipient.onion",
  timestamp: 123, status: "sent" as const, text: "Секретные данные",
  media: { fileId: "private-file", caption: "private-caption" },
};
const lifecycle = {
  key: "chat::m-1", chatKey: "chat", messageId: "m-1",
  updatedAt: 10, data: { editedText: "edited secret", isEdited: true },
};

describe("versioned protected message and lifecycle payloads (migration building blocks)", () => {
  it("roundtrips sensitive text and metadata with ciphertext only on disk", async () => {
    const k = await key(3);
    const encoded = await sealHistoryMessage(k, message);
    expect(encoded.kind).toBe(SEALED_MESSAGE_KIND);
    expect(JSON.stringify(encoded)).not.toContain(message.text);
    expect(JSON.stringify(encoded)).not.toContain("private-caption");
    expect(JSON.stringify(encoded)).not.toContain("private-file");
    expect(await openHistoryMessage(k, encoded)).toEqual(message);
  });
  it("rejects swapping ciphertext across users, IDs, or mutated indexed metadata", async () => {
    const k = await key(4);
    const encoded = await sealHistoryMessage(k, message);
    await expect(openHistoryMessage(k, {...encoded, id: "m-2"})).rejects.toThrow();
    await expect(openHistoryMessage(k, {...encoded, from: "attacker.onion"})).rejects.toThrow();
    await expect(openHistoryMessage(k, {...encoded, timestamp: 1})).rejects.toThrow();
    await expect(openHistoryMessage(await key(5), encoded)).rejects.toThrow();
  });
  it("disallows hybrid encrypted+plaintext records and malformed indexes", async () => {
    const k = await key(6);
    const encoded = await sealHistoryMessage(k, message);
    expect(() => parseProtectedMessageRow({...encoded, text: "plaintext leak"})).toThrow();
    expect(() => parseProtectedMessageRow({...encoded, status: "admin"})).toThrow();
    expect(() => parseProtectedMessageRow({...encoded, kind: "unknown"})).toThrow();
    expect(looksLikeProtectedHistoryRow({...encoded, kind: "unknown"})).toBe(true);
    expect(looksLikeProtectedHistoryRow(message)).toBe(false);
  });
  it("protects edit/delete history while preserving required Dexie indexes", async () => {
    const k = await key(7);
    const encrypted = await sealHistoryLifecycle(k, lifecycle);
    expect(encrypted.kind).toBe(SEALED_LIFECYCLE_KIND);
    expect(JSON.stringify(encrypted)).not.toContain("edited secret");
    expect(await openHistoryLifecycle(k, encrypted)).toEqual(lifecycle);
    await expect(openHistoryLifecycle(k, {...encrypted, messageId: "other"})).rejects.toThrow();
    await expect(openHistoryLifecycle(k, {...encrypted, updatedAt: 999})).rejects.toThrow();
    expect(() => parseProtectedLifecycleRow({...encrypted,data:{editedText:"oops"}})).toThrow();
  });
  it("fails closed on missing/wrong keys without decoding old plaintext", async () => {
    const k = await key(8);
    const encrypted = await sealHistoryLifecycle(k, lifecycle);
    await expect(openHistoryLifecycle(await key(9), encrypted)).rejects.toThrow();
    await expect(openHistoryMessage(k, message)).rejects.toThrow();
  });
  it("refuses lossy nested media and lifecycle fields before encryption", async () => {
    const encryptionKey = await key(10);
    await expect(sealHistoryMessage(encryptionKey, {
      ...message, media: { fileId: "secret", caption: undefined },
    })).rejects.toThrow();
    await expect(sealHistoryMessage(encryptionKey, {
      ...message, media: { image: new Blob(["private"]) },
    })).rejects.toThrow();
    await expect(sealHistoryLifecycle(encryptionKey, {
      ...lifecycle, data: { editedText: "safe", unknown: Number.NaN },
    })).rejects.toThrow();
  });
});
