import { describe, expect, it } from "vitest";
import { consumedMediaKey, isConsumedMediaRecord } from "../one-time-policy";
describe("persistent one-time media replay prevention", () => {
  it("isolates a tombstone for each attachment", () => {
    expect(consumedMediaKey("f_a")).not.toBe(consumedMediaKey("f_b"));
    expect(() => consumedMediaKey("")).toThrow();
    expect(() => consumedMediaKey("x".repeat(257))).toThrow();
  });
  it("allows viewing only when an explicit consumed flag is absent", () => {
    expect(isConsumedMediaRecord({ consumed: true, consumedAt: Date.now() })).toBe(true);
    expect(isConsumedMediaRecord({ consumed: false })).toBe(false);
    expect(isConsumedMediaRecord(null)).toBe(false);
    expect(isConsumedMediaRecord({})).toBe(false);
  });
});