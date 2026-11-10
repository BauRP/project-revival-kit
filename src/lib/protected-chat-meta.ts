/**
 * Android Keystore-backed encryption for the legacy chat-list metadata DB.
 *
 * This is an independently persisted copy of friend names, avatars and
 * last-message previews in trivo-chat/contacts (NOT the Dexie contacts table).
 * Android stores a versioned AES-GCM envelope under the original contact key.
 * Existing plaintext records are replaced only after an atomic compare/write.
 * Browser preview retains its old format and does not require Android Keystore.
 *
 * This protects chat summaries, not the whole message history in Dexie.
 */
import type { ChatMeta } from "./p2p";
import { dbGetStrict, dbGetAllStrict, dbPutIfUnchangedStrict } from "./storage";
import { sealLocalRecord, openLocalRecord, type SealedLocalRecord } from "./local-record-crypto";
import { acquireLocalDataKey } from "./protected-record-inventory";
import { platform } from "./platform";

const KIND = "trivo-sealed-chat-meta";
const VERSION = 1 as const;
const STORE = "contacts";

export interface SealedChatMeta {
  kind: typeof KIND;
  version: typeof VERSION;
  friendId: string; // IndexedDB primary key; not message content
  sealed: SealedLocalRecord;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Even a damaged envelope must never silently fall back to plaintext. */
export function isPotentialSealedChatMeta(value: unknown): boolean {
  return record(value) && ("sealed" in value || "kind" in value);
}

export function parseSealedChatMeta(value: unknown): SealedChatMeta {
  if (!record(value) || value.kind !== KIND || value.version !== VERSION ||
      typeof value.friendId !== "string" || !record(value.sealed) ||
      value.sealed.version !== 1 || value.sealed.algorithm !== "AES-256-GCM" ||
      typeof value.sealed.nonce !== "string" ||
      typeof value.sealed.ciphertext !== "string")
    throw new Error("Invalid encrypted chat metadata");
  return value as unknown as SealedChatMeta;
}

/** Validate before migration, encryption and release to the UI. */
export function assertValidChatMeta(value: unknown, friendId: string): asserts value is ChatMeta {
  if (!record(value) || typeof friendId !== "string" ||
      friendId.length < 1 || friendId.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(friendId) ||
      value.friendId !== friendId ||
      typeof value.friendName !== "string" || value.friendName.length > 512 ||
      typeof value.lastMessage !== "string" || value.lastMessage.length > 200_000 ||
      !Number.isSafeInteger(value.lastMessageTime) ||
      (value.lastMessageTime as number) < 0 ||
      !Number.isSafeInteger(value.unread) || (value.unread as number) < 0 ||
      typeof value.started !== "boolean" ||
      (value.friendAvatar !== undefined && value.friendAvatar !== null &&
        (typeof value.friendAvatar !== "string" ||
          value.friendAvatar.length > 262_144)))
    throw new Error("Invalid local chat metadata");
}

export async function sealChatMeta(key: CryptoKey, meta: ChatMeta): Promise<SealedChatMeta> {
  assertValidChatMeta(meta, meta.friendId);
  return {
    kind: KIND,
    version: VERSION,
    friendId: meta.friendId,
    sealed: await sealLocalRecord(key, STORE, meta.friendId, JSON.stringify(meta)),
  };
}

export async function openChatMeta(
  key: CryptoKey, friendId: string, raw: unknown,
): Promise<ChatMeta> {
  const envelope = parseSealedChatMeta(raw);
  if (envelope.friendId !== friendId)
    throw new Error("Encrypted chat metadata key mismatch");
  const plaintext = await openLocalRecord(key, STORE, friendId, envelope.sealed);
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext); }
  catch { throw new Error("Invalid authenticated chat metadata JSON"); }
  assertValidChatMeta(parsed, friendId);
  return parsed;
}

/** A write is not proven durable by IDB request success; verify the committed ciphertext. */
export async function commitSealedChatMeta(
  expected: ChatMeta,
  envelope: SealedChatMeta,
  io: {
    write: (value: SealedChatMeta) => Promise<void>;
    read: () => Promise<unknown>;
    decrypt: (value: unknown) => Promise<ChatMeta>;
  },
): Promise<void> {
  await io.write(envelope);
  const verified = await io.decrypt(await io.read());
  if (JSON.stringify(verified) !== JSON.stringify(expected))
    throw new Error("Encrypted chat metadata verification mismatch");
}

/** Encrypt a legacy row in-place, atomically replacing exactly the value read. */
async function openOrUpgrade(
  key: CryptoKey, friendId: string, original: unknown,
): Promise<ChatMeta> {
  if (isPotentialSealedChatMeta(original))
    return openChatMeta(key, friendId, original);
  assertValidChatMeta(original, friendId);
  const encrypted = await sealChatMeta(key, original);
  await commitSealedChatMeta(original, encrypted, {
    write: (value) => dbPutIfUnchangedStrict(STORE, friendId, original, value),
    read: () => dbGetStrict(STORE, friendId),
    decrypt: (value) => openChatMeta(key, friendId, value),
  });
  return original;
}

export async function readStoredChatMeta(friendId: string): Promise<ChatMeta | undefined> {
  const original = await dbGetStrict<unknown>(STORE, friendId);
  if (original === undefined) return undefined;
  if (platform() !== "android") return original as ChatMeta;
  const key = await acquireLocalDataKey();
  return openOrUpgrade(key, friendId, original);
}

/** Coherent legacy and encrypted records, decrypting in bounded batches. */
export async function readAllStoredChatMetas(): Promise<ChatMeta[]> {
  const entries = await dbGetAllStrict<unknown>(STORE);
  if (platform() !== "android") return entries as ChatMeta[];
  if (!entries.length) return [];
  const key = await acquireLocalDataKey();
  const result: ChatMeta[] = [];
  // Each original key is embedded for getAll; AES-GCM also authenticates the
  // primary key through AAD, so swapping two rows cannot transplant a summary.
  for (let i = 0; i < entries.length; i += 8) {
    const group = await Promise.all(entries.slice(i, i + 8).map(async (raw) => {
      if (!record(raw) || typeof raw.friendId !== "string")
        throw new Error("Invalid stored chat metadata identifier");
      return openOrUpgrade(key, raw.friendId, raw);
    }));
    result.push(...group);
  }
  return result;
}

/** Persist privately on Android; an aborted or concurrent write never counts as success. */
export async function saveStoredChatMeta(meta: ChatMeta): Promise<void> {
  if (platform() !== "android") {
    await dbPutIfUnchangedStrict(STORE, meta.friendId,
      await dbGetStrict(STORE, meta.friendId), meta);
    return;
  }
  assertValidChatMeta(meta, meta.friendId);
  const key = await acquireLocalDataKey();
  const previous = await dbGetStrict<unknown>(STORE, meta.friendId);
  if (previous !== undefined) {
    if (isPotentialSealedChatMeta(previous))
      await openChatMeta(key, meta.friendId, previous);
    else assertValidChatMeta(previous, meta.friendId);
  }
  const encrypted = await sealChatMeta(key, meta);
  await commitSealedChatMeta(meta, encrypted, {
    write: (value) => dbPutIfUnchangedStrict(STORE, meta.friendId, previous, value),
    read: () => dbGetStrict(STORE, meta.friendId),
    decrypt: (value) => openChatMeta(key, meta.friendId, value),
  });
}
