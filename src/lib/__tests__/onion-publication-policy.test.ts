import { describe, expect, it } from "vitest";
import { matchesPublishedOnion } from "../onion-publication-policy";

const a = "a".repeat(56) + ".onion";
const b = "b".repeat(56) + ".onion";

describe("fail-closed Tor service identity publication", () => {
  it("allows Tor to bootstrap without a published onion", () => {
    expect(matchesPublishedOnion(a, null)).toBe(true);
  });
  it("allows exactly the expected published onion", () => {
    expect(matchesPublishedOnion(a, a)).toBe(true);
    expect(matchesPublishedOnion(a, a.toUpperCase())).toBe(true);
  });
  it("never silently accepts a different or malformed service address", () => {
    expect(matchesPublishedOnion(a, b)).toBe(false);
    expect(matchesPublishedOnion(a, "not-an-onion")).toBe(false);
    expect(matchesPublishedOnion("broken", a)).toBe(false);
  });
});
