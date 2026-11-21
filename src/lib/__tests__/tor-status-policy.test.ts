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

describe("Tor indicator rejects aliases and unusable ports", () => {
  it("requires an exact raw v3 hostname", () => {
    expect(isTorServiceReady({ ...ready, onion: "https://" + ready.onion })).toBe(false);
    expect(isTorServiceReady({ ...ready, onion: ready.onion!.toUpperCase() })).toBe(false);
  });
  it("requires live native transport endpoints", () => {
    expect(isTorServiceReady({ ...ready, socksPort: 0 })).toBe(false);
    expect(isTorServiceReady({ ...ready, servicePort: 0 })).toBe(false);
    expect(isTorServiceReady({ ...ready, socksPort: Number.NaN })).toBe(false);
  });
});

describe("native Tor status never trusts invalid endpoint metadata", () => {
  it("requires bootstrap progress to be exactly complete", () => {
    expect(isTorServiceReady({ ...ready, bootstrapPercent: 101 })).toBe(false);
    expect(isTorServiceReady({ ...ready, bootstrapPercent: Number.NaN })).toBe(false);
  });
  it("rejects impossible TCP ports", () => {
    expect(isTorServiceReady({ ...ready, socksPort: 65536 })).toBe(false);
    expect(isTorServiceReady({ ...ready, servicePort: 65536 })).toBe(false);
  });
});
