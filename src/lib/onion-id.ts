// ============================================================================
//  v3 onion address <-> Ed25519 identity key.
//  ---------------------------------------------------------------------------
//  The user's identity IS their .onion address. It is derived locally from the
//  Ed25519 signing key (rend-spec-v3 §6):
//      onion = base32(PUBKEY || CHECKSUM || VERSION) + ".onion"
//      CHECKSUM = SHA3-256(".onion checksum" || PUBKEY || VERSION)[:2]
//  The same key is handed to tor (ADD_ONION ED25519-V3:<expanded key>), so the
//  hidden service published on Android has exactly this address, and any peer
//  can recover our public key from the address alone (no key directory).
// ============================================================================

import { sha3_256 } from "@noble/hashes/sha3.js";
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64 } from "tweetnacl-util";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const VERSION = 3;
const CHECKSUM_PREFIX = new TextEncoder().encode(".onion checksum");

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = B32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function checksum(pub: Uint8Array): Uint8Array {
  const input = new Uint8Array(CHECKSUM_PREFIX.length + 32 + 1);
  input.set(CHECKSUM_PREFIX, 0);
  input.set(pub, CHECKSUM_PREFIX.length);
  input[input.length - 1] = VERSION;
  return sha3_256(input).slice(0, 2);
}

export function normalizeOnion(value: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

/** Ed25519 public key (base64 or bytes) → `<56 chars>.onion`. */
export function onionFromPublicKey(publicKey: string | Uint8Array): string {
  const pub = typeof publicKey === "string" ? decodeBase64(publicKey) : publicKey;
  if (pub.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  const raw = new Uint8Array(35);
  raw.set(pub, 0);
  raw.set(checksum(pub), 32);
  raw[34] = VERSION;
  return `${base32Encode(raw)}.onion`;
}

/** Recover the 32-byte Ed25519 public key; null when the address is invalid. */
export function publicKeyFromOnion(onion: string): Uint8Array | null {
  const host = normalizeOnion(onion);
  if (!/^[a-z2-7]{56}\.onion$/.test(host)) return null;
  const raw = base32Decode(host.slice(0, 56));
  if (!raw || raw.length !== 35 || raw[34] !== VERSION) return null;
  const pub = raw.slice(0, 32);
  const sum = checksum(pub);
  if (sum[0] !== raw[32] || sum[1] !== raw[33]) return null;
  return pub;
}

export function isValidOnion(value: string): boolean {
  return publicKeyFromOnion(value) !== null;
}

/**
 * tor's ADD_ONION key blob for our signing key: the 64-byte "expanded" secret
 * (clamped SHA-512 of the 32-byte seed), base64, prefixed with ED25519-V3.
 */
export function torServiceKeyFromSigningSecret(signingSecretB64: string): string {
  const seed = decodeBase64(signingSecretB64).slice(0, 32);
  const h = nacl.hash(seed);
  h[0] &= 248;
  h[31] &= 127;
  h[31] |= 64;
  return `ED25519-V3:${encodeBase64(h)}`;
}
