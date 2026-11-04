import { describe, expect, it } from "vitest";
import { hasTransferTimedOut } from "../media-timeout-policy";

describe("resumable Tor attachment idle timeout", () => {
  it("keeps a long transfer active while new verified chunks arrive", () => {
    const idleMs = 120_000;
    // The request began an hour ago but a verified chunk arrived recently.
    expect(hasTransferTimedOut(3_600_000, 3_650_000, idleMs)).toBe(false);
    expect(hasTransferTimedOut(3_600_000, 3_720_000, idleMs)).toBe(true);
  });
  it("expires a stalled peer while leaving durable chunks for retry", () => {
    expect(hasTransferTimedOut(10_000, 130_001, 120_000)).toBe(true);
  });
  it("rejects invalid deadlines rather than leaking a transfer forever", () => {
    expect(() => hasTransferTimedOut(NaN, 10, 20)).toThrow();
    expect(() => hasTransferTimedOut(20, 10, 20)).toThrow();
    expect(() => hasTransferTimedOut(1, 10, 0)).toThrow();
  });
});
