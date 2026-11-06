/**
 * Android-only master key wrapping for the versioned local-record codec.
 * The caller must durably save the returned wrapped string BEFORE writing
 * any encrypted records. This module never auto-creates a key on unlock and
 * never falls back to plaintext when native Keystore is unavailable.
 */
import { registerPlugin } from "@capacitor/core";
import { hasNativePlugin, platform } from "./platform";
import { importLocalRecordKey } from "./local-record-crypto";

const vault = registerPlugin<{
  sealLocalDataKey(options: { keyBase64: string }): Promise<{ sealed: string }>;
  openLocalDataKey(options: { sealed: string }): Promise<{ keyBase64: string }>;
}>("SecureVault");

function requireVault() {
  if (platform() !== "android" || !hasNativePlugin("SecureVault"))
    throw new Error("Android Keystore required for local encryption");
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues)
    throw new Error("Secure on-device cryptography unavailable");
}
function encodeKey(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeKey(base64: string): Uint8Array {
  if (typeof base64 !== "string" || base64.length !== 44 ||
      !/^[A-Za-z0-9+/]{43}=$/.test(base64))
    throw new Error("Invalid wrapped local key material");
  try {
    const decoded = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    if (decoded.length !== 32 || encodeKey(decoded) !== base64)
      throw new Error("Invalid wrapped local key material");
    return decoded;
  } catch {
    throw new Error("Invalid wrapped local key material");
  }
}

export interface NewWrappedLocalRecordKey {
  /** Non-exportable CryptoKey: keep only in process memory. */
  key: CryptoKey;
  /** Only this ciphertext wrapper may be persisted, never plaintext key bytes. */
  wrapped: string;
}

/**
 * Explicit setup only. The caller owns atomic persistence of this wrapper;
 * do not call for existing encrypted DBs with a lost/unreadable key wrapper.
 */
export async function createWrappedLocalRecordKey(): Promise<NewWrappedLocalRecordKey> {
  requireVault();
  const material = crypto.getRandomValues(new Uint8Array(32));
  try {
    const key = await importLocalRecordKey(material);
    const result = await vault.sealLocalDataKey({ keyBase64: encodeKey(material) });
    if (!result || typeof result.sealed !== "string" || !result.sealed)
      throw new Error("Keystore did not wrap local encryption key");
    return { key, wrapped: result.sealed };
  } finally {
    material.fill(0);
  }
}

/**
 * Unwraps only an existing valid envelope. Never rotates a Keystore key or
 * returns an empty DB as a fallback when the protected key cannot be read.
 */
export async function openWrappedLocalRecordKey(wrapped: string): Promise<CryptoKey> {
  requireVault();
  if (typeof wrapped !== "string" || !wrapped || wrapped.length > 512)
    throw new Error("Invalid wrapped local key");
  const result = await vault.openLocalDataKey({ sealed: wrapped });
  const material = decodeKey(result?.keyBase64);
  try {
    return await importLocalRecordKey(material);
  } finally {
    material.fill(0);
  }
}
