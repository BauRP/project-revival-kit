import { describe, expect, it } from "vitest";
import { canonicalHistoryJson, sameHistoryJson } from "../history-json-snapshot";

describe("lossless canonical history snapshots", () => {
  it("compares the same content independent of property order", () => {
    expect(sameHistoryJson({ id: "1", data: { b: 2, a: [1, null] } },
      { data: { a: [1, null], b: 2 }, id: "1" })).toBe(true);
  });
  it("rejects unsupported fields and objects without silently dropping secrets", () => {
    for (const value of [
      { nested: { hidden: undefined } },
      { other: () => 1 },
      { media: new Blob(["secret"]) },
      { time: new Date() },
      { count: Number.POSITIVE_INFINITY },
      { arr: [1, undefined] },
    ]) expect(() => canonicalHistoryJson(value)).toThrow();
  });
  it("rejects cycles, sparse arrays, computed fields, non-enumerable fields", () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const sparse = new Array(3); sparse[1] = "message";
    const hidden = { a: 1 }; Object.defineProperty(hidden, "password", { value: "secret" });
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true, get: () => "private",
    });
    for (const value of [cycle, sparse, hidden, accessor]) {
      expect(() => canonicalHistoryJson(value)).toThrow();
    }
  });
  it("preserves private Unicode text and does not confuse unlike records", () => {
    const a = { message: "Секрет 🔒", metadata: { sent: true, count: 1 } };
    expect(JSON.parse(canonicalHistoryJson(a))).toEqual(a);
    expect(sameHistoryJson(a, { ...a, metadata: { sent: false, count: 1 } })).toBe(false);
    expect(sameHistoryJson(a, { ...a, metadata: { sent: true } })).toBe(false);
  });
});
