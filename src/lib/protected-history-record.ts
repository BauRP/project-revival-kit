/**
 * Versioned Keystore-backed encryption format for Dexie chat history.
 *
 * Deliberately NOT wired into live Dexie reads/writes yet: direct legacy
 * table consumers must be migrated together, not handed incompatible rows.
 * This codec provides actual authenticated records and strict recovery
 * primitives for that migration, without changing existing on-device data.
 *
 * Only the fields needed by existing Dexie indexes remain visible. All
 * other message properties, and lifecycle.data, are inside AES-GCM.
 * AES-GCM additionally authenticates immutable indexed identities.
 */
import type { StoredMessage, LifecycleRecord } from "./dexie-db";
import { canonicalHistoryJson } from "./history-json-snapshot";
import {
  sealLocalRecord, openLocalRecord, type SealedLocalRecord,
} from "./local-record-crypto";

export const SEALED_MESSAGE_KIND = "trivo-history-message-v1" as const;
export const SEALED_LIFECYCLE_KIND = "trivo-history-lifecycle-v1" as const;
const MESSAGE_AAD_TABLE = "history_messages";
const LIFECYCLE_AAD_TABLE = "history_lifecycle";
const STATUSES = new Set(["pending", "sent", "delivered", "read"]);
const MESSAGE_INDEX_FIELDS = new Set([
  "id", "from", "to", "timestamp", "status",
]);
const MESSAGE_STORED_FIELDS = new Set([
  ...MESSAGE_INDEX_FIELDS, "kind", "sealed",
]);
const LIFECYCLE_STORED_FIELDS = new Set([
  "key", "chatKey", "messageId", "updatedAt", "kind", "sealed",
]);

export interface ProtectedMessageRecord {
  kind: typeof SEALED_MESSAGE_KIND;
  id: string;
  from: string;
  to: string;
  timestamp: number;
  status: StoredMessage["status"];
  sealed: SealedLocalRecord;
}
export interface ProtectedLifecycleRecord {
  kind: typeof SEALED_LIFECYCLE_KIND;
  key: string;
  chatKey: string;
  messageId: string;
  updatedAt: number;
  sealed: SealedLocalRecord;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function recordIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
function indexTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function stringIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}
function strictFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error("Protected history contains plaintext or unknown fields");
  }
}
function messageIndexes(value: unknown): value is Record<string, unknown> & {
  id: string; from: string; to: string;
  timestamp: number; status: StoredMessage["status"];
} {
  if (!object(value)) return false;
  return recordIdentity(value.id) && stringIdentity(value.from) &&
    stringIdentity(value.to) && indexTime(value.timestamp) &&
    typeof value.status === "string" && STATUSES.has(value.status);
}
function lifecycleIndexes(value: unknown): value is Record<string, unknown> & {
  key: string; chatKey: string; messageId: string; updatedAt: number;
} {
  if (!object(value)) return false;
  return stringIdentity(value.key) && stringIdentity(value.chatKey) &&
    recordIdentity(value.messageId) && indexTime(value.updatedAt);
}

/** Conservative inventory: even a damaged sealed envelope blocks key reset. */
export function looksLikeProtectedHistoryRow(row: unknown): boolean {
  return object(row) && ("sealed" in row ||
    row.kind === SEALED_MESSAGE_KIND || row.kind === SEALED_LIFECYCLE_KIND);
}
export function parseProtectedMessageRow(value: unknown): ProtectedMessageRecord {
  if (!messageIndexes(value) || value.kind !== SEALED_MESSAGE_KIND ||
      !object(value.sealed))
    throw new Error("Invalid protected message index or version");
  strictFields(value, MESSAGE_STORED_FIELDS);
  return value as unknown as ProtectedMessageRecord;
}
export function parseProtectedLifecycleRow(value: unknown): ProtectedLifecycleRecord {
  if (!lifecycleIndexes(value) || value.kind !== SEALED_LIFECYCLE_KIND ||
      !object(value.sealed))
    throw new Error("Invalid protected lifecycle index or version");
  strictFields(value, LIFECYCLE_STORED_FIELDS);
  return value as unknown as ProtectedLifecycleRecord;
}

/** Prepare ciphertext OUTSIDE any Dexie transaction. */
export async function sealHistoryMessage(
  key: CryptoKey, message: StoredMessage,
): Promise<ProtectedMessageRecord> {
  if (!messageIndexes(message) || typeof message.text !== "string")
    throw new Error("Cannot protect malformed message");
  const extras: Record<string, unknown> = Object.create(null);
  for (const [name, value] of Object.entries(message)) {
    if (!MESSAGE_INDEX_FIELDS.has(name) && name !== "text") {
      // A future/legacy schema must not silently copy a conflicting encrypted
      // envelope into the private extras. Refuse ambiguous mixed records.
      if (name === "kind" || name === "sealed" || name === "__proto__" ||
          name === "constructor" || name === "prototype")
        throw new Error("Unsafe private message property");
      extras[name] = value;
    }
  }
  // Strict, canonical JSON rejects unsupported nested values, prototype
  // properties, Blob/Date objects and cyclic data before any plaintext row
  // is eligible for replacement. Ordinary field ordering is irrelevant.
  const payload = canonicalHistoryJson({
    id: message.id, from: message.from, to: message.to,
    timestamp: message.timestamp, text: message.text, extras,
  });
  return {
    kind: SEALED_MESSAGE_KIND,
    id: message.id, from: message.from, to: message.to,
    timestamp: message.timestamp, status: message.status,
    sealed: await sealLocalRecord(key, MESSAGE_AAD_TABLE, message.id, payload),
  };
}

/** Never fall back to a plaintext row on lost key or bad authentication. */
export async function openHistoryMessage(
  key: CryptoKey, raw: unknown,
): Promise<StoredMessage> {
  const row = parseProtectedMessageRow(raw);
  const plaintext = await openLocalRecord(
    key, MESSAGE_AAD_TABLE, row.id, row.sealed,
  );
  let payload: unknown;
  try { payload = JSON.parse(plaintext) as unknown; }
  catch { throw new Error("Invalid authenticated message JSON"); }
  if (!object(payload) || !canonicalHistoryJson(payload) ||
      payload.id !== row.id ||
      payload.from !== row.from || payload.to !== row.to ||
      payload.timestamp !== row.timestamp ||
      typeof payload.text !== "string" ||
      !object(payload.extras))
    throw new Error("Protected message indexed metadata mismatch");
  const result: StoredMessage = {
    id: row.id, from: row.from, to: row.to,
    timestamp: row.timestamp, status: row.status, text: payload.text,
  };
  for (const [name, value] of Object.entries(payload.extras)) {
    if (name === "text" || name === "kind" || name === "sealed" ||
        MESSAGE_INDEX_FIELDS.has(name) ||
        name === "__proto__" || name === "constructor" || name === "prototype")
      throw new Error("Invalid authenticated message field");
    result[name] = value;
  }
  return result;
}

/** Encrypt the complete private lifecycle.data while keeping indexes. */
export async function sealHistoryLifecycle(
  key: CryptoKey, row: LifecycleRecord,
): Promise<ProtectedLifecycleRecord> {
  if (!lifecycleIndexes(row) || !object(row.data))
    throw new Error("Cannot protect malformed message lifecycle");
  const payload = canonicalHistoryJson({
    key: row.key, chatKey: row.chatKey,
    messageId: row.messageId, updatedAt: row.updatedAt,
    data: row.data,
  });
  return {
    kind: SEALED_LIFECYCLE_KIND,
    key: row.key, chatKey: row.chatKey, messageId: row.messageId,
    updatedAt: row.updatedAt,
    sealed: await sealLocalRecord(key, LIFECYCLE_AAD_TABLE, row.key, payload),
  };
}
export async function openHistoryLifecycle(
  key: CryptoKey, raw: unknown,
): Promise<LifecycleRecord> {
  const row = parseProtectedLifecycleRow(raw);
  const plaintext = await openLocalRecord(
    key, LIFECYCLE_AAD_TABLE, row.key, row.sealed,
  );
  let payload: unknown;
  try { payload = JSON.parse(plaintext) as unknown; }
  catch { throw new Error("Invalid authenticated lifecycle JSON"); }
  if (!object(payload) || !canonicalHistoryJson(payload) ||
      payload.key !== row.key ||
      payload.chatKey !== row.chatKey || payload.messageId !== row.messageId ||
      payload.updatedAt !== row.updatedAt || !object(payload.data))
    throw new Error("Protected lifecycle indexed metadata mismatch");
  return {
    key: row.key, chatKey: row.chatKey,
    messageId: row.messageId, updatedAt: row.updatedAt,
    data: payload.data,
  };
}
