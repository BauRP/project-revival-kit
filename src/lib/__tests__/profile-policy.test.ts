import { describe, expect, it } from "vitest";
import { nextProfileTimestamp, validateEditableProfile } from "../profile-policy";
const profile = () => ({
  name: "My profile", avatar: null, status: "online" as const,
  customStatus: "Available",
});
describe("strict local profile persistence policy", () => {
  it("permits safe local names and multilingual statuses", () => {
    expect(() => validateEditableProfile(profile())).not.toThrow();
    expect(() => validateEditableProfile({ ...profile(), customStatus: "Привет! Қазақша" })).not.toThrow();
  });
  it("refuses oversized names/avatars and invalid statuses before writing", () => {
    expect(() => validateEditableProfile({ ...profile(), name: "x".repeat(81) })).toThrow();
    expect(() => validateEditableProfile({ ...profile(), avatar: "https://tracker.example/avatar.png" })).toThrow();
    expect(() => validateEditableProfile({ ...profile(), status: "unverified" as "online" })).toThrow();
  });
  it("uses strictly increasing timestamps for rapid successive edits", () => {
    expect(nextProfileTimestamp(100, 100)).toBe(101);
    expect(nextProfileTimestamp(101, 100)).toBe(102);
    expect(nextProfileTimestamp(101, 900)).toBe(900);
  });
});

describe("canonical persisted avatar and safe profile clocks", () => {
  it("rejects corrupt Base64 at the local save boundary before it reaches peers", () => {
    expect(() => validateEditableProfile({
      ...profile(), avatar: "data:image/png;base64,AQ==",
    })).not.toThrow();
    for (const avatar of [
      "data:image/png;base64,",
      "data:image/png;base64,AR==",
      "data:image/webp;base64,AA=",
      "data:image/png;base64,AQ===",
    ]) expect(() => validateEditableProfile({ ...profile(), avatar })).toThrow();
  });
  it("refuses numeric timestamp overflow rather than losing edit order", () => {
    expect(() => nextProfileTimestamp(Number.MAX_SAFE_INTEGER, 10)).toThrow();
    expect(nextProfileTimestamp(100, 100)).toBe(101);
  });
});
