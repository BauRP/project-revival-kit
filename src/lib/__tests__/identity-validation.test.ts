import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import { validateIdentityKeys, type IdentityKeys } from "../crypto";

const makeIdentity = (): IdentityKeys => {
  const signing = nacl.sign.keyPair();
  const exchange = nacl.box.keyPair();
  return {
    signing: { publicKey: encodeBase64(signing.publicKey), secretKey: encodeBase64(signing.secretKey) },
    exchange: { publicKey: encodeBase64(exchange.publicKey), secretKey: encodeBase64(exchange.secretKey) },
    createdAt: Date.now(),
  };
};

describe("identity recovery validation", () => {
  it("accepts a matching Ed25519 and X25519 identity", () => {
    const identity = makeIdentity();
    expect(validateIdentityKeys(identity)).toBe(identity);
  });

  it("rejects a signing public key substituted by a different identity", () => {
    const identity = makeIdentity();
    identity.signing.publicKey = makeIdentity().signing.publicKey;
    expect(() => validateIdentityKeys(identity)).toThrow();
  });

  it("rejects a mismatched X25519 key and truncated private keys", () => {
    const identity = makeIdentity();
    identity.exchange.publicKey = makeIdentity().exchange.publicKey;
    expect(() => validateIdentityKeys(identity)).toThrow();
    identity.exchange.secretKey = encodeBase64(new Uint8Array(8));
    expect(() => validateIdentityKeys(identity)).toThrow();
  });

  it("rejects incomplete identity records, preventing accidental identity replacement", () => {
    expect(() => validateIdentityKeys({} as IdentityKeys)).toThrow();
  });
});
