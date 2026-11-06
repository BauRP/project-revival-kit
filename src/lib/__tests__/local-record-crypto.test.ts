import { describe, expect, it } from "vitest";
import {
  importLocalRecordKey, sealLocalRecord, openLocalRecord,
} from "../local-record-crypto";

const key = async (fill: number) =>
  importLocalRecordKey(new Uint8Array(32).fill(fill));

describe("local encrypted record building block", () => {
  it("authenticates UTF-8 plaintext and never stores its body in the record", async () => {
    const secret = "Сәлем, 你好, confidential message";
    const k = await key(1);
    const sealed = await sealLocalRecord(k, "messages", "message-1", secret);
    expect(JSON.stringify(sealed)).not.toContain(secret);
    expect(await openLocalRecord(k, "messages", "message-1", sealed)).toBe(secret);
  });
  it("requires a non-exportable AES key and a fresh nonce per record", async () => {
    await expect(importLocalRecordKey(new Uint8Array(16))).rejects.toThrow();
    const k = await key(2);
    expect(k.extractable).toBe(false);
    const a = await sealLocalRecord(k, "messages", "id", "same text");
    const b = await sealLocalRecord(k, "messages", "id", "same text");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("cannot transplant ciphertext to another table or message ID", async () => {
    const k = await key(3);
    const sealed = await sealLocalRecord(k, "messages", "one", "secret");
    await expect(openLocalRecord(k, "messages", "two", sealed)).rejects.toThrow();
    await expect(openLocalRecord(k, "lifecycle", "one", sealed)).rejects.toThrow();
    await expect(openLocalRecord(await key(4), "messages", "one", sealed)).rejects.toThrow();
  });
  it("fails closed on tampering, malformed Base64, and unknown schema", async () => {
    const k = await key(5);
    const sealed = await sealLocalRecord(k, "messages", "id", "private");
    await expect(openLocalRecord(k, "messages", "id", {
      ...sealed, ciphertext: sealed.ciphertext.slice(0, -4) + "AAAA",
    })).rejects.toThrow();
    await expect(openLocalRecord(k, "messages", "id", {
      ...sealed, nonce: "AA",
    })).rejects.toThrow();
    await expect(openLocalRecord(k, "messages", "id", {
      ...sealed, version: 2,
    } as never)).rejects.toThrow();
    await expect(sealLocalRecord(k, "invalid table", "id", "secret")).rejects.toThrow();
    await expect(sealLocalRecord(k, "messages", "bad\nID", "secret")).rejects.toThrow();
  });
});
