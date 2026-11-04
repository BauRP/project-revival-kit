import { describe, expect, it } from "vitest";
import { isTorServiceReady } from "../tor-status-policy";
import type { TorStatus } from "../tor-native";
import { onionFromPublicKey } from "../onion-id";

const ready: TorStatus = {
  running: true, bootstrapped: true, bootstrapPercent: 100,
  onion: onionFromPublicKey(new Uint8Array(32).fill(1)), socksPort: 9050, servicePort: 8443,
  lastError: null,
};

describe("honest Tor connection indicator", () => {
  it("shows connected only for a running, published and error-free service", () => {
    expect(isTorServiceReady(ready)).toBe(true);
    expect(isTorServiceReady({ ...ready, running: false })).toBe(false);
    expect(isTorServiceReady({ ...ready, bootstrapped: false })).toBe(false);
    expect(isTorServiceReady({ ...ready, bootstrapPercent: 99 })).toBe(false);
    expect(isTorServiceReady({ ...ready, onion: null })).toBe(false);
    expect(isTorServiceReady({ ...ready, onion: "example.onion" })).toBe(false);
    expect(isTorServiceReady({ ...ready, lastError: "mismatched identity" })).toBe(false);
  });
});
