/**
 * Encrypted portable Trivo backup V2.
 *
 * No servers or network requests. WebCrypto PBKDF2-SHA256 with per-backup
 * 256-bit random salt and AES-256-GCM with a fresh 96-bit nonce.
 * The old NaCl/SHA512 V1 format stays read-only for compatibility.
 */
const MAGIC = "TRIVO-BACKUP-V2";
const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export interface BackupEnvelopeV2 {
  magic: typeof MAGIC;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  cipher: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  createdAt: number;
}
const base64 = (input: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < input.length; i += 0x8000)
    binary += String.fromCharCode(...input.subarray(i, i + 0x8000));
  return btoa(binary);
};
const bytes = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (typeof password !== "string" || password.trim().length < 12)
    throw new Error("Use a backup password of at least 12 characters");
  if (!globalThis.crypto?.subtle) throw new Error("Secure on-device cryptography is unavailable");
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
export async function encryptBackupV2(plaintext: string, password: string): Promise<BackupEnvelopeV2> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return {
    magic: MAGIC, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
    salt: base64(salt), cipher: "AES-256-GCM", iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)), createdAt: Date.now(),
  };
}
export async function decryptBackupV2(envelope: BackupEnvelopeV2, password: string): Promise<string> {
  if (!envelope || envelope.magic !== MAGIC || envelope.kdf !== "PBKDF2-SHA256" ||
      envelope.cipher !== "AES-256-GCM" || envelope.iterations !== ITERATIONS)
    throw new Error("Unsupported or invalid encrypted backup");
  const salt = bytes(envelope.salt);
  const iv = bytes(envelope.iv);
  if (salt.length !== 32 || iv.length !== 12)
    throw new Error("Invalid backup salt or nonce");
  const key = await derive(password, salt, envelope.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, key, bytes(envelope.ciphertext),
    );
    return dec.decode(plain);
  } catch {
    throw new Error("Incorrect password or damaged backup file");
  }
}
