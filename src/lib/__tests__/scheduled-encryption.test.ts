import { describe, expect, it } from "vitest";
import { isSealedScheduledText, protectScheduledText, revealScheduledText } from "../scheduled-encryption";
import { sameScheduledIdentity } from "../scheduled-policy";

describe("scheduled Android Keystore ciphertext policy", () => {
  it("distinguishes sealed records from legacy plaintext without false positives", () => {
    expect(isSealedScheduledText("hello world")).toBe(false);
    expect(isSealedScheduledText("TRIVO-SCHEDULED-V1:")).toBe(false);
    expect(isSealedScheduledText("TRIVO-SCHEDULED-V1:nonce.ciphertext")).toBe(true);
  });
  it("keeps the wire identity stable across sealed schedule retries", () => {
    const item = { id: "a", chatId: "peer", text: "TRIVO-SCHEDULED-V1:123",
      scheduledAt: 1000, createdAt: 400 };
    expect(sameScheduledIdentity(item, item)).toBe(true);
    expect(sameScheduledIdentity(item, { ...item, text: "TRIVO-SCHEDULED-V1:456" })).toBe(false);
  });
  it("keeps the browser development fallback readable only without native vault", async () => {
    expect(await protectScheduledText("hello")).toBe("hello");
    expect(await revealScheduledText("hello")).toBe("hello");
  });
});
