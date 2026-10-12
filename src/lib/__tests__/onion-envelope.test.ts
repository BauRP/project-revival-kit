import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import { onionFromPublicKey, publicKeyFromOnion, isValidOnion } from "../onion-id";
import { sealFrame, openFrame } from "../envelope";

const kp = () => {
  const k = nacl.sign.keyPair();
  return { pub: encodeBase64(k.publicKey), sec: encodeBase64(k.secretKey) };
};

describe("onion identity", () => {
  it("accepts a real Tor v3 address (Tor Project) and rejects a corrupted one", () => {
    const real = "2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion";
    expect(isValidOnion(real)).toBe(true);
    expect(onionFromPublicKey(publicKeyFromOnion(real)!)).toBe(real);
    expect(isValidOnion(real.replace("2g", "3g"))).toBe(false);
  });
});

describe("E2EE envelope", () => {
  it("only the recipient can open, and tampering is rejected", () => {
    const a = kp(),
      b = kp(),
      c = kp();
    const A = onionFromPublicKey(a.pub),
      B = onionFromPublicKey(b.pub),
      C = onionFromPublicKey(c.pub);
    const f = sealFrame({ hello: "world" }, A, B, a.sec);
    expect(JSON.stringify(f)).not.toContain("world");
    expect(openFrame(f, B, b.sec)).toEqual({ hello: "world" });
    expect(() => openFrame({ ...f, to: C }, C, c.sec)).toThrow();
    expect(() => openFrame({ ...f, c: f.c.slice(0, -4) + "AAAA" }, B, b.sec)).toThrow();
  });
});
