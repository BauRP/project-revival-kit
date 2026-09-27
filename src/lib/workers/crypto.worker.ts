// ============================================================================
//  Dedicated crypto / parsing worker.
//  ---------------------------------------------------------------------------
//  Every NaCl operation (Ed25519 signing + verification, X25519 box seal /
//  open) and every large JSON parse/stringify runs here, OFF the main UI
//  thread. The UI thread only posts a job and awaits a structured reply, so a
//  burst of inbound onion frames can never block rendering or input handling
//  (which is what Android Vitals reports as an ANR).
// ============================================================================

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";

export type CryptoJobKind =
  | "sign"
  | "verify"
  | "encrypt"
  | "decrypt"
  | "parse"
  | "stringify"
  | "keygen";

export interface CryptoJob {
  id: number;
  kind: CryptoJobKind;
  payload: Record<string, unknown>;
}

export interface CryptoJobResult {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

function run(kind: CryptoJobKind, p: Record<string, unknown>): unknown {
  switch (kind) {
    case "keygen": {
      // Ed25519 + X25519 keypair generation. This is the single heaviest
      // cryptographic operation of the whole boot sequence, so it MUST never
      // execute on the UI thread (it is what stalls WebView creation on
      // Android and surfaces as "App has stopped" / ANR on first launch).
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
    case "sign": {
      const sig = nacl.sign.detached(decodeUTF8(String(p.data)), decodeBase64(String(p.secretKey)));
      return encodeBase64(sig);
    }
    case "verify": {
      return nacl.sign.detached.verify(
        decodeUTF8(String(p.data)),
        decodeBase64(String(p.signature)),
        decodeBase64(String(p.publicKey)),
      );
    }
    case "encrypt": {
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const box = nacl.box(
        decodeUTF8(String(p.plaintext)),
        nonce,
        decodeBase64(String(p.recipientPublicKey)),
        decodeBase64(String(p.senderSecretKey)),
      );
      if (!box) throw new Error("Encryption failed");
      return { ciphertext: encodeBase64(box), nonce: encodeBase64(nonce) };
    }
    case "decrypt": {
      const opened = nacl.box.open(
        decodeBase64(String(p.ciphertext)),
        decodeBase64(String(p.nonce)),
        decodeBase64(String(p.senderPublicKey)),
        decodeBase64(String(p.recipientSecretKey)),
      );
      if (!opened) throw new Error("Decryption failed — invalid key or tampered data");
      return encodeUTF8(opened);
    }
    case "parse":
      return JSON.parse(String(p.raw));
    case "stringify":
      return JSON.stringify(p.value);
    default:
      throw new Error(`Unknown crypto job: ${String(kind)}`);
  }
}

self.addEventListener("message", (event: MessageEvent<CryptoJob>) => {
  const job = event.data;
  if (!job || typeof job.id !== "number") return;
  let result: CryptoJobResult;
  try {
    result = { id: job.id, ok: true, value: run(job.kind, job.payload ?? {}) };
  } catch (error) {
    result = {
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  (self as unknown as Worker).postMessage(result);
});

export {};
