// Ed25519 + X25519 + XSalsa20-Poly1305 encryption layer using tweetnacl
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";
import { dbGetStrict, dbPutStrict, dbCountStrict } from "./storage";
import { assertCanGenerateNewIdentity } from "./identity-bootstrap-policy";
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform";

const vault = registerPlugin<{
  sealIdentity(p: { plaintext: string }): Promise<{ sealed: string }>;
  openIdentity(p: { sealed: string }): Promise<{ plaintext: string }>;
  saveIdentity(p: { sealed: string }): Promise<void>;
  loadIdentity(): Promise<{ sealed: string | null }>;
  clearIdentity(): Promise<void>;
}>("SecureVault");

/** Persist a verified recovery identity in the same Android Keystore and
 * crash-recovery locations as normal first-run identity initialization.
 * Call only after explicit empty-device confirmation.
 */
export async function installRecoveredIdentity(value: IdentityKeys): Promise<void> {
  const identity = validateIdentityKeys(value);
  if (isNative()) {
    const wrapped = await vault.sealIdentity({ plaintext: JSON.stringify(identity) });
    await vault.saveIdentity({ sealed: wrapped.sealed });
    await dbPutStrict("identity", "keys", wrapped);
  } else {
    await dbPutStrict("identity", "keys", identity);
  }
}

export async function eraseIdentityVault(): Promise<void> {
  if (isNative()) await vault.clearIdentity();
  loadingIdentity = null;
}


export interface KeyPair {
  publicKey: string; // base64
  secretKey: string; // base64
}

export interface IdentityKeys {
  signing: KeyPair; // Ed25519 for identity
  exchange: KeyPair; // X25519 for key exchange / encryption
  createdAt: number;
}

/**
 * Synchronous keypair generation for explicit non-boot call sites only.
 */
export function generateIdentityKeysSync(): IdentityKeys {
  const signingKP = nacl.sign.keyPair();
  const exchangeKP = nacl.box.keyPair();
  return {
    signing: {
      publicKey: encodeBase64(signingKP.publicKey),
      secretKey: encodeBase64(signingKP.secretKey),
    },
    exchange: {
      publicKey: encodeBase64(exchangeKP.publicKey),
      secretKey: encodeBase64(exchangeKP.secretKey),
    },
    createdAt: Date.now(),
  };
}

/** Validate stored keypairs before they can be used or restored. */
export function validateIdentityKeys(value: IdentityKeys): IdentityKeys {
  if (!value || !value.signing || !value.exchange ||
      !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0 ||
      value.createdAt > Date.now() + 600_000)
    throw new Error("Invalid stored identity structure");
  const signingSecret = decodeBase64(value.signing.secretKey);
  const exchangeSecret = decodeBase64(value.exchange.secretKey);
  const signingPublic = decodeBase64(value.signing.publicKey);
  const exchangePublic = decodeBase64(value.exchange.publicKey);
  if (signingSecret.length !== nacl.sign.secretKeyLength ||
      exchangeSecret.length !== nacl.box.secretKeyLength ||
      signingPublic.length !== nacl.sign.publicKeyLength ||
      exchangePublic.length !== nacl.box.publicKeyLength)
    throw new Error("Invalid stored identity key length");
  const actualSigning = nacl.sign.keyPair.fromSecretKey(signingSecret).publicKey;
  const actualExchange = nacl.box.keyPair.fromSecretKey(exchangeSecret).publicKey;
  if (!nacl.verify(actualSigning, signingPublic) || !nacl.verify(actualExchange, exchangePublic))
    throw new Error("Stored identity public/private keys do not match");
  return value;
}

/**
 * Generate or load the local Ed25519 + X25519 identity.
 * Generation is delegated to the crypto Web Worker so the UI thread stays free
 * during first launch; the dynamic import avoids a module cycle.
 */
// Single flight prevents two simultaneous first-launch callers from generating
// different identities and overwriting one another.
let loadingIdentity: Promise<IdentityKeys> | null = null;
export function getOrCreateIdentity(): Promise<IdentityKeys> {
  if (loadingIdentity) return loadingIdentity;
  const task = loadOrCreateIdentity();
  loadingIdentity = task;
  void task.finally(() => { if (loadingIdentity === task) loadingIdentity = null; }).catch(() => undefined);
  return task;
}

async function loadOrCreateIdentity(): Promise<IdentityKeys> {
  const existing = await dbGetStrict<IdentityKeys | { sealed: string }>("identity", "keys");
  if (isNative()) {
    if (existing && "sealed" in existing) {
      const unlocked = await vault.openIdentity({ sealed: existing.sealed });
      const identity = validateIdentityKeys(JSON.parse(unlocked.plaintext) as IdentityKeys);
      await vault.saveIdentity({ sealed: existing.sealed });
      return validateIdentityKeys(identity);
    }
    if (existing && "signing" in existing) {
      validateIdentityKeys(existing);
      // Crash-safe migration: encrypt and persist a device-recovery copy before
      // replacing the old unprotected IndexedDB record.
      const wrapped = await vault.sealIdentity({ plaintext: JSON.stringify(existing) });
      await vault.saveIdentity({ sealed: wrapped.sealed });
      await dbPutStrict("identity", "keys", wrapped);
      return validateIdentityKeys(existing);
    }
    const recovery = await vault.loadIdentity();
    if (recovery.sealed) {
      const unlocked = await vault.openIdentity({ sealed: recovery.sealed });
      const identity = validateIdentityKeys(JSON.parse(unlocked.plaintext) as IdentityKeys);
      await dbPutStrict("identity", "keys", { sealed: recovery.sealed });
      return validateIdentityKeys(identity);
    }
  } else if (existing && "signing" in existing) {
    return validateIdentityKeys(existing);
  }
  // A wiped identity record (or lost Android Keystore) is NOT a new user.
  // Only an actually empty installation may generate a fresh onion address.
  // Check both current Dexie and legacy stores without reading message text.
  const { dxdb } = await import("./dexie-db");
  const counts = await Promise.all([
    dxdb.contacts.count(), dxdb.messages.count(), dxdb.outbox.count(),
    dxdb.inbox_raw.count(), dxdb.lifecycle.count(), dxdb.blobs.count(),
    dxdb.partial_chunks.count(), dbCountStrict("contacts"), dbCountStrict("messages"),
  ]);
  // An orphaned scheduled message or a sealed Tor frame is proof that
  // this device already had an identity. Do not discard either by replacing
  // the keypair. Both checks propagate errors rather than treating them as 0.
  const { listOutbox } = await import("./outbox");
  const scheduledMessages = (await listOutbox()).length;
  let nativeFrames = 0;
  if (isNative()) {
    const { isTorNativeAvailable, TorTransport } = await import("./tor-native");
    if (!isTorNativeAvailable())
      throw new Error("Native Tor bridge unavailable; cannot verify prior identity state");
    nativeFrames = (await TorTransport.inboundCount()).count;
  }
  assertCanGenerateNewIdentity({
    contacts: counts[0], messages: counts[1], outbox: counts[2],
    inbound: counts[3], lifecycle: counts[4], blobs: counts[5],
    chunks: counts[6], legacyContacts: counts[7], legacyMessages: counts[8],
    scheduledMessages, nativeFrames,
  });
  const { generateIdentityKeysAsync } = await import("./crypto-async");
  const identity = await generateIdentityKeysAsync();
  if (isNative()) {
    const wrapped = await vault.sealIdentity({ plaintext: JSON.stringify(identity) });
    await vault.saveIdentity({ sealed: wrapped.sealed });
    await dbPutStrict("identity", "keys", wrapped);
  } else {
    await dbPutStrict("identity", "keys", identity);
  }
  return validateIdentityKeys(identity);
}

/**
 * Encrypt a message for a recipient using X25519 + XSalsa20-Poly1305 (NaCl box).
 */
export function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  senderSecretKey: string,
): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msgBytes = decodeUTF8(plaintext);
  const pubKey = decodeBase64(recipientPublicKey);
  const secKey = decodeBase64(senderSecretKey);

  const encrypted = nacl.box(msgBytes, nonce, pubKey, secKey);
  if (!encrypted) throw new Error("Encryption failed");

  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message from a sender.
 */
export function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string,
): string {
  const decrypted = nacl.box.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    decodeBase64(senderPublicKey),
    decodeBase64(recipientSecretKey),
  );
  if (!decrypted) throw new Error("Decryption failed — invalid key or tampered data");
  return encodeUTF8(decrypted);
}

/**
 * Sign data with Ed25519.
 */
export function signData(data: string, secretKey: string): string {
  const sig = nacl.sign.detached(decodeUTF8(data), decodeBase64(secretKey));
  return encodeBase64(sig);
}

/**
 * Verify Ed25519 signature.
 */
export function verifySignature(data: string, signature: string, publicKey: string): boolean {
  return nacl.sign.detached.verify(
    decodeUTF8(data),
    decodeBase64(signature),
    decodeBase64(publicKey),
  );
}

/**
 * БОСС: Новый алгоритм генерации уникального ID.
 * Мы используем SHA-256 и переводим его в HEX (цифры и буквы A-F),
 * чтобы ID был солидным и уникальным.
 */
export function getKeyFingerprint(publicKey: string): string {
  try {
    const bytes = decodeBase64(publicKey);
    // Используем SHA-512 через NaCl для более длинного хеша
    const hash = nacl.hash(bytes);

    // Превращаем байты в HEX-строку (0-9, A-F)
    const hex = Array.from(hash)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

    // Берем 12 символов и разбиваем их дефисом для удобства чтения
    // Например: 4A2D-8B1C-E9F0
    const part1 = hex.substring(0, 4);
    const part2 = hex.substring(4, 8);
    const part3 = hex.substring(8, 12);

    return `${part1}-${part2}-${part3}`;
  } catch (e) {
    // A random fingerprint would undermine identity verification. Fail closed.
    throw new Error("Cannot calculate the identity key fingerprint", { cause: e });
  }
}

/**
 * PQXDH is not implemented in this application.
 *
 * This fail-closed compatibility stub intentionally rejects calls rather
 * than mislabeling random padding plus classic NaCl as post-quantum crypto.
 * Implement a real, reviewed ML-KEM + authenticated hybrid handshake with
 * versioned wire formats before enabling a PQXDH capability flag.
 */
export function pqxdhEncrypt(
  _plaintext: string,
  _recipientPublicKey: string,
  _senderSecretKey: string,
): { ciphertext: string; nonce: string; pqEntropy: string } {
  throw new Error("PQXDH is not available: post-quantum key agreement is not implemented");
}

export function pqxdhDecrypt(
  _ciphertext: string,
  _nonce: string,
  _senderPublicKey: string,
  _recipientSecretKey: string,
): string {
  throw new Error("PQXDH is not available: post-quantum key agreement is not implemented");
}
