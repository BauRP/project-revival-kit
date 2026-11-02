/** Restrict decrypted but untrusted backup content before any DB mutation. */
const MAX_RECORDS = 250_000;
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS)
    throw new Error(`Invalid backup ${label}`);
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[\\u0000-\\u001f\\u007f]/.test(value);
}
export function validateBackupStructure(dump: unknown): void {
  if (!record(dump) || dump.schemaVersion !== 3 ||
      typeof dump.createdAt !== "number" ||
      !Number.isSafeInteger(dump.createdAt) || dump.createdAt <= 0 ||
      dump.createdAt > Date.now() + 600_000)
    throw new Error("Backup schema version mismatch");
  const contacts = array(dump.contacts, "contacts");
  const messages = array(dump.messages, "messages");
  const lifecycle = array(dump.lifecycle, "lifecycle");
  const blobs = array(dump.blobs, "blobs");
  array(dump.outbox, "outbox"); // Historic outbox is intentionally never replayed.
  for (const x of contacts)
    if (!record(x) || !id(x.onion, 128)) throw new Error("Invalid backup contact");
  for (const x of messages)
    if (!record(x) || !id(x.id, 128) || !id(x.from, 128) ||
        !id(x.to, 128) || typeof x.text !== "string" || x.text.length > 200_000 ||
        typeof x.timestamp !== "number" || !Number.isSafeInteger(x.timestamp))
      throw new Error("Invalid backup message");
  for (const x of lifecycle)
    if (!record(x) || !id(x.key, 1024) || !id(x.chatKey, 256) ||
        !id(x.messageId, 256) || !record(x.data))
      throw new Error("Invalid backup lifecycle");
  for (const x of blobs)
    if (!record(x) || !id(x.fileId, 128) || !id(x.name, 255) ||
        typeof x.mimeType !== "string" || x.mimeType.length > 128 ||
        typeof x.size !== "number" || !Number.isSafeInteger(x.size) ||
        x.size < 0 || x.size > 1024 * 1024 * 1024 ||
        typeof x.dataB64 !== "string" ||
        x.dataB64.length > Math.ceil(x.size / 3) * 4 + 8 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(x.dataB64))
      throw new Error("Invalid backup attachment");
}
