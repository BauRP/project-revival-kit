/**
 * Encrypt decrypted Tor transfer fragments at rest in the Android APK.
 * Does not claim the rest of the local message database is encrypted.
 *
 * New Android chunks use the isolated Keystore-wrapped AES-256 data key.
 * Existing legacy plaintext chunks remain readable, so app updates do not
 * destroy incomplete transfers. On web preview retain legacy behavior.
 */
import { dxdb, type PartialBlobChunkRecord } from "./dexie-db";
import { openLocalRecord, sealLocalRecord, type SealedLocalRecord } from "./local-record-crypto";
import { acquirePersistedLocalRecordKey } from "./local-record-key-store";
import { platform } from "./platform";
import { matchesChunkDigest } from "./chunk-integrity";
import { mayUpgradeLegacyChunk } from "./legacy-chunk-migration";

export const MAX_DECRYPTED_CHUNK_BYTES = 48 * 1024;
const ENCRYPTED_CHUNK_MIME = "application/x-trivo-encrypted-chunk";
const MAX_ENCRYPTED_CHUNK_BYTES = 100 * 1024;
let keyTask: Promise<CryptoKey> | null = null;

/** Keystore failures on Android must never silently fall back to plaintext. */
export function shouldEncryptPartialChunks(): boolean {
  return platform() === "android";
}

async function obtainAndroidChunkKey(): Promise<CryptoKey> {
  if (!keyTask) {
    keyTask = acquirePersistedLocalRecordKey(async () =>
      (await dxdb.partial_chunks.filter((r) =>
        r.encrypted === 1 || r.data.type === ENCRYPTED_CHUNK_MIME,
      ).count()) === 0,
    ).catch((error: unknown) => {
      keyTask = null;
      throw error;
    });
  }
  return keyTask;
}

function encodeBytes(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 0x4000) {
    result += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  }
  return btoa(result);
}

function decodeBytes(text: string): Uint8Array {
  if (typeof text !== "string" ||
      text.length > 4 * Math.ceil(MAX_DECRYPTED_CHUNK_BYTES / 3) ||
      text.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error("Invalid decrypted Tor chunk encoding");
  let raw: string;
  try { raw = atob(text); }
  catch { throw new Error("Invalid decrypted Tor chunk encoding"); }
  if (raw.length > MAX_DECRYPTED_CHUNK_BYTES)
    throw new Error("Oversized decrypted Tor chunk");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (encodeBytes(bytes) !== text)
    throw new Error("Noncanonical decrypted Tor chunk");
  return bytes;
}

export type ProtectedChunkPayload =
  Pick<PartialBlobChunkRecord, "data" | "encrypted" | "plaintextSize">;

export async function protectPartialChunkBytes(
  key: CryptoKey, rowId: string, bytes: Uint8Array,
): Promise<ProtectedChunkPayload> {
  if (!rowId || !(bytes instanceof Uint8Array) ||
      bytes.length > MAX_DECRYPTED_CHUNK_BYTES)
    throw new Error("Invalid Tor chunk to encrypt");
  const sealed = await sealLocalRecord(
    key, "partial_chunks", rowId, encodeBytes(bytes),
  );
  const data = new Blob([JSON.stringify(sealed)], { type: ENCRYPTED_CHUNK_MIME });
  if (data.size > MAX_ENCRYPTED_CHUNK_BYTES)
    throw new Error("Encrypted Tor chunk exceeds size limit");
  return { data, encrypted: 1, plaintextSize: bytes.length };
}

/** Authentication failure or missing Keystore key never becomes raw media. */
export async function openPartialChunkBytes(
  row: Pick<PartialBlobChunkRecord, "key" | "data" | "encrypted" | "plaintextSize">,
  key?: CryptoKey,
): Promise<Uint8Array> {
  if (row.encrypted === undefined) {
    if (row.data.type === ENCRYPTED_CHUNK_MIME)
      throw new Error("Missing encrypted Tor chunk marker");
    if (row.data.size > MAX_DECRYPTED_CHUNK_BYTES)
      throw new Error("Oversized legacy Tor chunk");
    return new Uint8Array(await row.data.arrayBuffer());
  }
  if (row.encrypted !== 1 || !key)
    throw new Error("Missing Tor media key or unsupported encryption version");
  if (!Number.isSafeInteger(row.plaintextSize) ||
      row.plaintextSize! < 0 || row.plaintextSize! > MAX_DECRYPTED_CHUNK_BYTES ||
      row.data.type !== ENCRYPTED_CHUNK_MIME ||
      row.data.size <= 0 || row.data.size > MAX_ENCRYPTED_CHUNK_BYTES)
    throw new Error("Malformed encrypted Tor chunk metadata");
  let sealed: SealedLocalRecord;
  try { sealed = JSON.parse(await row.data.text()) as SealedLocalRecord; }
  catch { throw new Error("Malformed encrypted Tor chunk envelope"); }
  const payload = await openLocalRecord(key, "partial_chunks", row.key, sealed);
  const bytes = decodeBytes(payload);
  if (bytes.length !== row.plaintextSize)
    throw new Error("Authenticated chunk length mismatch");
  return bytes;
}

export function persistedChunkPlainSize(
  row: Pick<PartialBlobChunkRecord, "data" | "encrypted" | "plaintextSize">,
): number {
  if (row.encrypted === undefined) {
    if (row.data.type === ENCRYPTED_CHUNK_MIME) return -1;
    return row.data.size;
  }
  return row.encrypted === 1 && Number.isSafeInteger(row.plaintextSize)
    ? row.plaintextSize! : -1;
}

/** Encrypt outside a Dexie transaction, commit ciphertext inside it. */
export async function sealIncomingChunk(
  rowId: string, bytes: Uint8Array,
): Promise<ProtectedChunkPayload> {
  if (shouldEncryptPartialChunks()) {
    return protectPartialChunkBytes(await obtainAndroidChunkKey(), rowId, bytes);
  }
  return { data: new Blob([new Uint8Array(bytes)]) };
}

export async function readIncomingChunk(
  row: Pick<PartialBlobChunkRecord, "key" | "data" | "encrypted" | "plaintextSize">,
): Promise<Uint8Array> {
  const key = row.encrypted === 1 ? await obtainAndroidChunkKey() : undefined;
  return openPartialChunkBytes(row, key);
}

/**
 * Best-effort migration for legacy plaintext in-progress downloads. Verify
 * integrity before encrypting, and atomically compare the original snapshot
 * before replacing. On any Keystore/storage error retain the original bytes,
 * allowing the next app run to retry without losing the transfer.
 */
export async function upgradeVerifiedLegacyChunk(
  row: PartialBlobChunkRecord,
  alreadyReadBytes: Uint8Array,
): Promise<boolean> {
  if (!shouldEncryptPartialChunks() || row.encrypted !== undefined ||
      row.data.type === ENCRYPTED_CHUNK_MIME ||
      !matchesChunkDigest(alreadyReadBytes, row.digest))
    return false;
  const encrypted = await sealIncomingChunk(row.key, alreadyReadBytes);
  if (encrypted.encrypted !== 1) return false;
  return dxdb.transaction("rw", dxdb.partial_chunks, async () => {
    const latest = await dxdb.partial_chunks.get(row.key);
    if (!mayUpgradeLegacyChunk(row, latest)) return false;
    await dxdb.partial_chunks.update(row.key, {
      ...encrypted, updatedAt: Date.now(),
    });
    return true;
  });
}
