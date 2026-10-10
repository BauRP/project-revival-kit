// ============================================================================
//  Mandatory E2EE envelope for every frame that leaves the device over Tor.
//  ---------------------------------------------------------------------------
//  seal():  inner JSON → NaCl box (ephemeral X25519 → recipient X25519, where
//           the recipient key is converted from the Ed25519 key embedded in
//           their .onion address) → Ed25519 signature by the sender.
//  open():  verify signature with the key recovered from `from` → decrypt with
//           our own X25519 secret (converted from our Ed25519 seed).
//  The wire frame only carries {v, from, to, ts, epk, n, c, sig}; no plaintext
//  field exists in the format, so plaintext egress is structurally impossible.
// ============================================================================

import { ed25519 } from "@noble/curves/ed25519.js";
import nacl from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";
import { publicKeyFromOnion } from "./onion-id";

export interface SealedFrame {
  v: 2;
  from: string;
  to: string;
  ts: number;
  epk: string;
  n: string;
  c: string;
  sig: string;
}

function signedBytes(f: Omit<SealedFrame, "sig">): Uint8Array {
  return decodeUTF8(`${f.v}|${f.from}|${f.to}|${f.ts}|${f.epk}|${f.n}|${f.c}`);
}

export function sealFrame(
  inner: unknown,
  fromOnion: string,
  toOnion: string,
  signingSecretB64: string,
): SealedFrame {
  const recipientEd = publicKeyFromOnion(toOnion);
  if (!recipientEd) throw new Error("seal: invalid recipient onion address");
  const recipientX = ed25519.utils.toMontgomery(recipientEd);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(decodeUTF8(JSON.stringify(inner)), nonce, recipientX, eph.secretKey);
  const unsigned = {
    v: 2 as const,
    from: fromOnion,
    to: toOnion,
    ts: Date.now(),
    epk: encodeBase64(eph.publicKey),
    n: encodeBase64(nonce),
    c: encodeBase64(box),
  };
  const sig = nacl.sign.detached(signedBytes(unsigned), decodeBase64(signingSecretB64));
  return { ...unsigned, sig: encodeBase64(sig) };
}

/** Returns the decrypted inner object, or throws when forged / not for us. */
export function openFrame(frame: SealedFrame, selfOnion: string, signingSecretB64: string): unknown {
  if (!frame || frame.v !== 2) throw new Error("open: unsupported frame version");
  if (frame.to !== selfOnion) throw new Error("open: frame not addressed to this device");
  const senderEd = publicKeyFromOnion(frame.from);
  if (!senderEd) throw new Error("open: invalid sender onion address");
  const { sig, ...unsigned } = frame;
  if (!nacl.sign.detached.verify(signedBytes(unsigned), decodeBase64(sig), senderEd)) {
    throw new Error("open: signature verification failed");
  }
  const seed = decodeBase64(signingSecretB64).slice(0, 32);
  const selfX = ed25519.utils.toMontgomerySecret(seed);
  const opened = nacl.box.open(
    decodeBase64(frame.c),
    decodeBase64(frame.n),
    decodeBase64(frame.epk),
    selfX,
  );
  if (!opened) throw new Error("open: decryption failed");
  return JSON.parse(encodeUTF8(opened));
}
