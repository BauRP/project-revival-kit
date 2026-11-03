/**
 * A decrypted portable backup is still untrusted input. Validate it completely
 * before opening the Dexie write transaction. Legacy backups use this check too.
 */
const MAX_RECORDS_PER_TABLE = 250_000;
const MAX_TOTAL_RECORDS = 300_000;
// V2 ciphertext is limited to 256 MiB; reject pathological arrays before
// decoding every media field into an additional in-memory Blob.
const MAX_TOTAL_MEDIA_BASE64 = 256 * 1024 * 1024;
const MAX_BLOB_SIZE = 1024 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS_PER_TABLE)
    throw new Error("Invalid backup " + label);
  return value;
}

function id(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

/** Check the decoded size without allocating or decoding untrusted base64. */
function validMediaBase64(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== "string") return false;
  if (expectedBytes === 0) return value.length === 0;
  if (value.length !== 4 * Math.ceil(expectedBytes / 3)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const padding = (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  return padding === (3 - (expectedBytes % 3)) % 3;
}

export function validateBackupStructure(dump: unknown): void {
  if (!record(dump) || dump.schemaVersion !== 3 ||
      !Number.isSafeInteger(dump.createdAt) ||
      (dump.createdAt as number) <= 0 ||
      (dump.createdAt as number) > Date.now() + 600_000)
    throw new Error("Backup schema version mismatch");

  const contacts = array(dump.contacts, "contacts");
  const messages = array(dump.messages, "messages");
  const outbox = array(dump.outbox, "outbox");
  const lifecycle = array(dump.lifecycle, "lifecycle");
  const blobs = array(dump.blobs, "blobs");
  if (contacts.length + messages.length + outbox.length + lifecycle.length + blobs.length > MAX_TOTAL_RECORDS)
    throw new Error("Backup contains too many records");

  for (const x of contacts)
    if (!record(x) || !id(x.onion, 128))
      throw new Error("Invalid backup contact");

  for (const x of messages) {
    if (!record(x) || !id(x.id, 128) || !id(x.from, 128) ||
        !id(x.to, 128) || typeof x.text !== "string" ||
        x.text.length > 200_000 || !Number.isSafeInteger(x.timestamp) ||
        (x.timestamp as number) < 0)
      throw new Error("Invalid backup message");
    if (x.media !== undefined) {
      if (!record(x.media) || !id(x.media.fileId, 128) ||
          !["image", "audio", "file", "video"].includes(String(x.media.type)) ||
          !id(x.media.name, 255) ||
          typeof x.media.mimeType !== "string" || x.media.mimeType.length > 128 ||
          !Number.isSafeInteger(x.media.size) ||
          (x.media.size as number) < 0 || (x.media.size as number) > MAX_BLOB_SIZE)
        throw new Error("Invalid backup message attachment");
    }
  }

  // Outgoing ciphertext in a backup is inert after restore, but is still
  // untrusted input. Avoid accepting executable shapes or multi-megabyte
  // "frame" fields into a database that may be inspected later.
  for (const x of outbox) {
    if (!record(x) || !id(x.id, 128) || !id(x.peer, 128) ||
        typeof x.kind !== "string" || !id(x.kind, 64) ||
        typeof x.frame !== "string" || x.frame.length < 1 ||
        x.frame.length > 12 * 1024 * 1024 ||
        !["pending", "sent", "failed"].includes(String(x.status)) ||
        !Number.isSafeInteger(x.attempts) || (x.attempts as number) < 0 ||
        (x.attempts as number) > 1_000_000 ||
        !Number.isSafeInteger(x.createdAt) || (x.createdAt as number) <= 0 ||
        !Number.isSafeInteger(x.updatedAt) || (x.updatedAt as number) <= 0 ||
        !Number.isSafeInteger(x.nextAttemptAt) || (x.nextAttemptAt as number) < 0)
      throw new Error("Invalid backup outbox record");
  }

  for (const x of lifecycle)
    if (!record(x) || !id(x.key, 1024) || !id(x.chatKey, 256) ||
        !id(x.messageId, 256) || !record(x.data))
      throw new Error("Invalid backup lifecycle");

  let encodedMediaBytes = 0;
  for (const x of blobs) {
    if (!record(x) || !id(x.fileId, 128) || !id(x.name, 255) ||
        typeof x.mimeType !== "string" || x.mimeType.length > 128 ||
        !Number.isSafeInteger(x.size) || (x.size as number) < 0 ||
        (x.size as number) > MAX_BLOB_SIZE ||
        !validMediaBase64(x.dataB64, x.size as number))
      throw new Error("Invalid backup attachment");
    encodedMediaBytes += (x.dataB64 as string).length;
    if (encodedMediaBytes > MAX_TOTAL_MEDIA_BASE64)
      throw new Error("Backup media exceeds the current portable format limit");
  }
}
