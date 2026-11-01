import { describe, expect, it } from "vitest";
import { localProtectionKey, remoteProtectionKey, validProtectionUpdate, HistoryProtectionError } from "../history-protection";

describe("per-chat protected history", () => {
  it("keeps self and peer settings separate for each chat", () => {
    expect(localProtectionKey("alice.onion")).not.toBe(localProtectionKey("bob.onion"));
    expect(localProtectionKey("alice.onion")).not.toBe(remoteProtectionKey("alice.onion"));
  });
  it("requires a boolean status and an eligible monotonic timestamp", () => {
    expect(validProtectionUpdate(true,100,200)).toBe(true);
    expect(validProtectionUpdate(false,101,200)).toBe(true);
    expect(validProtectionUpdate("true",100,200)).toBe(false);
    expect(validProtectionUpdate(true,-1,200)).toBe(false);
    expect(validProtectionUpdate(true,100_000_000,200)).toBe(false);
  });
  it("reports the requested restriction rather than silently deleting a message", () => {
    expect(new HistoryProtectionError().message).toContain("защита истории переписки");
  });
});