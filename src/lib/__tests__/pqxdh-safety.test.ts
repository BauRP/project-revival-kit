import { describe, expect, it } from "vitest";
import { pqxdhEncrypt, pqxdhDecrypt } from "../crypto";

describe("post-quantum crypto capability is never fabricated", () => {
  it("refuses to label classical NaCl as PQXDH encryption", () => {
    expect(() => pqxdhEncrypt("hello", "public", "secret")).toThrow(/not available/);
  });
  it("refuses to treat legacy padding as PQXDH decryption", () => {
    expect(() => pqxdhDecrypt("ciphertext", "nonce", "public", "secret")).toThrow(/not available/);
  });
});
