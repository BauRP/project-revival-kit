import { describe, expect, it } from "vitest";
import { deniedByHistoryProtection } from "../history-protection-policy";
describe("history protection: local recipient enforcement", () => {
  it("blocks remote edits and delete-for-everyone while enabled", () => {
    for (const patch of [{isEdited:true},{editedText:"changed"},{deletedForEveryone:true}]) {
      expect(deniedByHistoryProtection(true, patch)).toBe(true);
      expect(deniedByHistoryProtection(false, patch)).toBe(false);
    }
  });
  it("does not block unrelated pin controls or local-only delete-for-me", () => {
    expect(deniedByHistoryProtection(true, {pinnedAt:100})).toBe(false);
    expect(deniedByHistoryProtection(true, {deletedFor:["self"]})).toBe(false);
  });
});
import { deniedByStoredHistoryProtection } from "../history-protection-policy";
describe("corrupt durable protection cannot be bypassed by remote Tor mutations", () => {
  const changed = { editedText: "delete-me" };
  const removed = { deletedForEveryone: true };
  it("allows an edit only where a valid stored state disables protection", () => {
    expect(deniedByStoredHistoryProtection(undefined, changed)).toBe(false);
    expect(deniedByStoredHistoryProtection({ data: { enabled: false, updatedAt: 1 } }, changed)).toBe(false);
    expect(deniedByStoredHistoryProtection({ data: { enabled: true, updatedAt: 1 } }, changed)).toBe(true);
  });
  it("rejects destructive remote actions if the stored protection row is damaged", () => {
    for (const value of [undefined, null, {}, { enabled: false, updatedAt: "1" }, { enabled: "false", updatedAt: 1 }]) {
      const row = { data: value };
      expect(deniedByStoredHistoryProtection(row, changed)).toBe(true);
      expect(deniedByStoredHistoryProtection(row, removed)).toBe(true);
      expect(deniedByStoredHistoryProtection(row, { pinnedAt: 22 })).toBe(false);
    }
  });
});

import { isCurrentHistoryProtectionDispatch } from "../history-protection-policy";
describe("outgoing history protection is monotonic across rapid toggles", () => {
  const row = {
    key: "history-protection::local::peer", chatKey: "history-protection-local",
    messageId: "peer", updatedAt: 12, data: { enabled: true, updatedAt: 12 },
  };
  it("accepts only the latest committed choice, not the earlier sealed frame", () => {
    expect(isCurrentHistoryProtectionDispatch(row, "peer", true, 12)).toBe(true);
    expect(isCurrentHistoryProtectionDispatch(row, "peer", false, 12)).toBe(false);
    expect(isCurrentHistoryProtectionDispatch(row, "peer", true, 11)).toBe(false);
    expect(isCurrentHistoryProtectionDispatch({...row, data: { enabled: true, updatedAt: 11 }},
      "peer", true, 12)).toBe(false);
    expect(isCurrentHistoryProtectionDispatch(undefined, "peer", true, 12)).toBe(false);
  });
});
