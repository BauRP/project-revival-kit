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