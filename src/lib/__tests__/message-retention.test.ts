import { describe, expect, it } from "vitest";
import { hasExpiredMessage } from "../message-retention";

describe("disappearing-message clock policy", () => {
  it("expires at the exact configured moment", () => {
    expect(hasExpiredMessage(1000, 999)).toBe(false);
    expect(hasExpiredMessage(1000, 1000)).toBe(true);
    expect(hasExpiredMessage(1000, 1001)).toBe(true);
  });
  it("rejects missing, malformed or nonpositive deadlines", () => {
    for (const value of [undefined, null, "1000", NaN, Infinity, -100, 0, 1.5])
      expect(hasExpiredMessage(value, 10000)).toBe(false);
  });
});
