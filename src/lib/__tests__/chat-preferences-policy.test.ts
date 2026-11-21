import { describe, it, expect } from "vitest";
import {
  validateChatPreferenceState, getDeleteAt, MUTE_FOREVER,
} from "../chat-preferences";

describe("chat preference safety and compatibility", () => {
  it("retains independent settings and unknown legacy fields", () => {
    const old = {
      blocked: true, favorite: false, disappearingDuration: "6h",
      silentDefault: true, legacySetting: "keep",
    };
    const next = validateChatPreferenceState({
      ...validateChatPreferenceState(old), archived: true,
    });
    expect(next.blocked).toBe(true);
    expect(next.silentDefault).toBe(true);
    expect(next.disappearingDuration).toBe("6h");
    expect((next as Record<string, unknown>).legacySetting).toBe("keep");
  });
  it("rejects malformed security and disappearing settings", () => {
    for (const value of [
      { blocked: "false" }, { oneTimeDefault: "true" },
      { silentDefault: 1 }, { disappearingDuration: "7days" },
      { mutedUntil: -1 }, { mutedUntil: NaN },
      { mutedUntil: "forever" }, [], "invalid",
    ]) expect(() => validateChatPreferenceState(value)).toThrow();
    expect(validateChatPreferenceState({
      mutedUntil: MUTE_FOREVER, disappearingDuration: "off",
    }).mutedUntil).toBe(MUTE_FOREVER);
  });
  it("preserves disappearing expiry policy", () => {
    expect(getDeleteAt(100, "1h")).toBe(3_600_100);
    expect(getDeleteAt(100, "off")).toBeUndefined();
  });
});

describe("disappearing-message timestamps do not silently become NaN", () => {
  it("refuses malformed duration and clock without deleting valid chat history", () => {
    expect(() => getDeleteAt(100, "invalid" as "1h")).toThrow();
    expect(() => getDeleteAt(NaN, "1h")).toThrow();
    expect(() => getDeleteAt(-1, "off")).toThrow();
    expect(() => getDeleteAt(Number.MAX_SAFE_INTEGER, "1h")).toThrow();
    expect(getDeleteAt(100, "1h")).toBe(3600100);
    expect(getDeleteAt(100, "off")).toBeUndefined();
  });
});
