import { describe, expect, it } from "vitest";
import { chatAllowsOutbound, validateChatPreferenceState } from "../chat-preferences";

describe("blocked contact outbound privacy for scheduled and profile updates", () => {
  it("preserves legacy unblocked schedules and unrelated mute settings", () => {
    for (const value of [undefined, null, {}, { blocked: false },
      { mutedUntil: 99 }, { blocked: false, silentDefault: true }]) {
      expect(chatAllowsOutbound(value)).toBe(true);
    }
  });

  it("prevents a previously scheduled or saved profile update reaching a blocked contact", () => {
    expect(chatAllowsOutbound({ blocked: true })).toBe(false);
    expect(chatAllowsOutbound({ blocked: true, favorite: true })).toBe(false);
  });

  it("fails closed on corrupted persisted privacy controls without treating them as unblocked", () => {
    for (const value of ["allowed", [], 1, { blocked: "false" },
      { blocked: null }, { silentDefault: 1 }, { mutedUntil: -5 },
      { disappearingDuration: "never" }]) {
      expect(chatAllowsOutbound(value)).toBe(false);
    }
  });

  it("does not rewrite stored preference state when evaluating outbound permission", () => {
    const state = { blocked: true, archived: true, favorite: true };
    expect(chatAllowsOutbound(state)).toBe(false);
    expect(state).toEqual({ blocked: true, archived: true, favorite: true });
    expect(validateChatPreferenceState({ blocked: false })).toEqual({ blocked: false });
  });
});
