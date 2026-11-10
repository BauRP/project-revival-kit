import { describe, expect, it, vi } from "vitest";
import { importLocalRecordKey } from "../local-record-crypto";
import {
  assertValidChatMeta, sealChatMeta, openChatMeta, parseSealedChatMeta,
  isPotentialSealedChatMeta, commitSealedChatMeta,
} from "../protected-chat-meta";
import { protectedContactsContainCiphertext } from "../protected-record-inventory";
import type { ChatMeta } from "../p2p";

const peer = "a".repeat(56) + ".onion";
const meta = (): ChatMeta => ({
  friendId: peer, friendName: "Секретный друг", friendAvatar: "data:image/png;base64,AQ==",
  lastMessage: "Құпия хабарлама", lastMessageTime: 123456789, unread: 2,
  started: true,
});
const key = (fill: number) => importLocalRecordKey(new Uint8Array(32).fill(fill));

describe("encrypted legacy chat-list metadata on Android", () => {
  it("hides friend name, avatar and last message while keeping only the lookup key", async () => {
    const k = await key(41);
    const original = meta();
    const record = await sealChatMeta(k, original);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(original.friendName);
    expect(serialized).not.toContain(original.lastMessage);
    expect(serialized).not.toContain(original.friendAvatar as string);
    expect(record.friendId).toBe(peer);
    expect(await openChatMeta(k, peer, record)).toEqual(original);
  });

  it("rejects row swaps, key loss, ciphertext corruption and unknown envelopes", async () => {
    const original = await sealChatMeta(await key(42), meta());
    await expect(openChatMeta(await key(43), peer, original)).rejects.toThrow();
    await expect(openChatMeta(await key(42), "different.onion", original))
      .rejects.toThrow("key mismatch");
    await expect(openChatMeta(await key(42), peer, {
      ...original, sealed: { ...original.sealed, ciphertext: "wrong==" },
    })).rejects.toThrow();
    await expect(openChatMeta(await key(42), peer, {
      ...original, kind: "unsupported-v2",
    })).rejects.toThrow("Invalid encrypted");
    expect(() => parseSealedChatMeta({ friendId: peer, sealed: {} })).toThrow();
    expect(isPotentialSealedChatMeta({ friendId: peer, sealed: {} })).toBe(true);
  });

  it("does not accept a malformed legacy contact or a mismatched identity", () => {
    expect(() => assertValidChatMeta(meta(), peer)).not.toThrow();
    expect(() => assertValidChatMeta({ ...meta(), friendId: "different" }, peer))
      .toThrow();
    for (const extra of [
      { unread: -1 }, { started: "true" }, { lastMessage: 123 },
      { lastMessageTime: Number.POSITIVE_INFINITY },
    ]) expect(() => assertValidChatMeta({ ...meta(), ...extra }, peer)).toThrow();
  });

  it("never marks an uncommitted or unauthenticated ciphertext as saved", async () => {
    const k = await key(44);
    const original = meta();
    const encrypted = await sealChatMeta(k, original);
    let disk: unknown = original;
    const compareAndPut = vi.fn(async (value: unknown) => { disk = value; });
    await commitSealedChatMeta(original, encrypted, {
      write: compareAndPut,
      read: async () => disk,
      decrypt: (raw) => openChatMeta(k, peer, raw),
    });
    expect(compareAndPut).toHaveBeenCalledOnce();
    const failure = vi.fn(async () => { throw new Error("quota exceeded"); });
    await expect(commitSealedChatMeta(original, encrypted, {
      write: failure,
      read: async () => encrypted,
      decrypt: (raw) => openChatMeta(k, peer, raw),
    })).rejects.toThrow("quota exceeded");
    await expect(commitSealedChatMeta(original, encrypted, {
      write: async () => undefined,
      read: async () => ({ ...encrypted, sealed: { ...encrypted.sealed, nonce: "broken" } }),
      decrypt: (raw) => openChatMeta(k, peer, raw),
    })).rejects.toThrow();
  });

  it("detects lost-key risk even for damaged sealed rows in contacts inventory", () => {
    expect(protectedContactsContainCiphertext([])).toBe(false);
    expect(protectedContactsContainCiphertext([meta()])).toBe(false);
    expect(protectedContactsContainCiphertext([
      meta(), { kind: "trivo-sealed-chat-meta", friendId: peer, sealed: {} },
    ])).toBe(true);
    expect(protectedContactsContainCiphertext([{ sealed: null }])).toBe(true);
    expect(protectedContactsContainCiphertext([{ kind: "unknown-encrypted-format" }]))
      .toBe(true);
  });
});
