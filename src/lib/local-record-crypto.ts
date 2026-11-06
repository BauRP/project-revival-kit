/**
 * Versioned authenticated ciphertext building block for future Dexie at-rest
 * protection. This module does NOT activate encryption of existing records.
 *
 * The AES-256 key must be generated and unlocked by a device Keystore-backed
 * key lifecycle; never store raw key bytes in IndexedDB or localStorage.
 * Bind both table and primary key as AES-GCM additional authenticated data
 * to prevent ciphertext substitution between rows.
 */
const VERSION = 1 as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_PLAINTEXT_BYTES = 1024 * 1024;
const MAX_CIPHERTEXT_B64 = 4 * Math.ceil((MAX_PLAINTEXT_BYTES + 16) / 3);

export interface SealedLocalRecord {
  version: typeof VERSION;
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
}

function encode64(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(result);
}
function decode64(value: unknown, max: number): Uint8Array {
  if (typeof value !== "string" || !value || value.length > max ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error("Malformed local record encoding");
  try {
    const raw = atob(value);
    const result = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (encode64(result) !== value) throw new Error("Noncanonical local record encoding");
    return result;
  } catch {
    throw new Error("Malformed local record encoding");
  }
}
function binding(table: string, recordId: string): Uint8Array {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(table) ||
      typeof recordId !== "string" || recordId.length < 1 || recordId.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(recordId))
    throw new Error("Invalid local record identity");
  return encoder.encode(JSON.stringify(["trivo-local-record", VERSION, table, recordId]));
}

/** The key's raw bytes must come from a Keystore-protected key hierarchy. */
export async function importLocalRecordKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (!(rawKey instanceof Uint8Array) || rawKey.byteLength !== 32)
    throw new Error("Local storage AES key must be exactly 32 bytes");
  if (!globalThis.crypto?.subtle) throw new Error("Secure on-device WebCrypto unavailable");
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealLocalRecord(
  key: CryptoKey, table: string, recordId: string, plaintext: string,
): Promise<SealedLocalRecord> {
  const aad = binding(table, recordId);
  if (typeof plaintext !== "string") throw new Error("Invalid plaintext");
  const bytes = encoder.encode(plaintext);
  if (bytes.byteLength > MAX_PLAINTEXT_BYTES) throw new Error("Local record too large");
  if (!globalThis.crypto?.subtle) throw new Error("Secure on-device WebCrypto unavailable");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key, bytes,
  );
  return {
    version: VERSION, algorithm: "AES-256-GCM",
    nonce: encode64(iv), ciphertext: encode64(new Uint8Array(ciphertext)),
  };
}

export async function openLocalRecord(
  key: CryptoKey, table: string, recordId: string, sealed: SealedLocalRecord,
): Promise<string> {
  const aad = binding(table, recordId);
  if (!sealed || sealed.version !== VERSION || sealed.algorithm !== "AES-256-GCM")
    throw new Error("Unsupported encrypted local record version");
  const iv = decode64(sealed.nonce, 16);
  const ciphertext = decode64(sealed.ciphertext, MAX_CIPHERTEXT_B64 + 4);
  if (iv.byteLength !== 12 || ciphertext.byteLength < 16 ||
      ciphertext.byteLength > MAX_PLAINTEXT_BYTES + 16)
    throw new Error("Invalid encrypted local record lengths");
  if (!globalThis.crypto?.subtle) throw new Error("Secure on-device WebCrypto unavailable");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      key, ciphertext,
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("Local record authentication failed");
  }
}
