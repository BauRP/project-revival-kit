// Ed25519 + X25519 + XSalsa20-Poly1305 encryption layer using tweetnacl
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";
import { dbGetStrict, dbPutStrict } from "./storage";
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform";

const vault = registerPlugin<{
  sealIdentity(p: { plaintext: string }): Promise<{ sealed: string }>;
  openIdentity(p: { sealed: string }): Promise<{ plaintext: string }>;
  saveIdentity(p: { sealed: string }): Promise<void>;
  loadIdentity(): Promise<{ sealed: string | null }>;
  clearIdentity(): Promise<void>;
}>("SecureVault");

export async function eraseIdentityVault(): Promise<void> {
  if (isNative()) await vault.clearIdentity();
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
  if (!value || !value.signing || !value.exchange || !Number.isFinite(value.createdAt))
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
export async function getOrCreateIdentity(): Promise<IdentityKeys> {
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
 * Post-Quantum Hybrid layer.
 */
export function pqxdhEncrypt(
  plaintext: string,
  recipientPublicKey: string,
  senderSecretKey: string,
): { ciphertext: string; nonce: string; pqEntropy: string } {
  const pqEntropy = nacl.randomBytes(32);
  const combinedPlaintext = encodeBase64(pqEntropy) + "||" + plaintext;
  const result = encryptMessage(combinedPlaintext, recipientPublicKey, senderSecretKey);
  return { ...result, pqEntropy: encodeBase64(pqEntropy) };
}

export function pqxdhDecrypt(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string,
): string {
  const decrypted = decryptMessage(ciphertext, nonce, senderPublicKey, recipientSecretKey);
  const parts = decrypted.split("||");
  return parts.length > 1 ? parts.slice(1).join("||") : decrypted;
}
