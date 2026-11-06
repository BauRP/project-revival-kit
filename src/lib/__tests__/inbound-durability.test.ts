import { describe, expect, it } from "vitest";
import { isLegacyFriendEvent, isPermanentlyInvalidInboundFrame, canReuseInboundRawId } from "../inbound-durability";

describe("incoming Tor cross-database durability", () => {
  it("retains friend events until the separate database transaction completes", () => {
    expect(isLegacyFriendEvent("friend_request")).toBe(true);
    expect(isLegacyFriendEvent("friend_request_status")).toBe(true);
  });
  it("commits all other dispatches to the transactional Dexie inbox", () => {
    for (const kind of ["text_message","message_lifecycle","message_reaction","message_status"]) {
      expect(isLegacyFriendEvent(kind)).toBe(false);
    }
  });
});

describe("encrypted inbound recovery after transient crypto failures", () => {
  it("rejects only verified permanent authentication/frame errors", () => {
    for (const msg of [
      "open: unsupported frame version",
      "open: frame not addressed to this device",
      "open: invalid sender onion address",
      "open: signature verification failed",
      "open: decryption failed",
      "open: malformed decrypted JSON",
      "Invalid decrypted frame",
      "Invalid decrypted frame body",
    ]) expect(isPermanentlyInvalidInboundFrame(new Error(msg))).toBe(true);
  });
  it("retains ciphertext for retry if worker, DB, or identity access fails", () => {
    for (const failure of [
      new Error("crypto worker crashed"),
      new Error("Keystore temporarily unavailable"),
      new Error("IndexedDB quota exceeded"),
      new Error("Crypto worker timed out"),
      new Error("Unexpected token"),
      new Error("unknown error"),
      null, "open: decryption failed",
    ]) expect(isPermanentlyInvalidInboundFrame(failure)).toBe(false);
  });
});

describe("durable signed frame ID cannot overwrite another ciphertext", () => {
  it("accepts a first frame and byte-identical retransmission", () => {
    expect(canReuseInboundRawId(undefined, "signed-frame")).toBe(true);
    expect(canReuseInboundRawId("signed-frame", "signed-frame")).toBe(true);
  });
  it("rejects conflicting raw contents under one signature-derived key", () => {
    expect(canReuseInboundRawId("legitimate-sealed-data", "forged-sealed-data")).toBe(false);
    expect(canReuseInboundRawId("", "different")).toBe(false);
  });
});
