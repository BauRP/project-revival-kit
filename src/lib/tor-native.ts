// ============================================================================
//  Native Tor bridge (Capacitor plugin "TorTransport").
//  ---------------------------------------------------------------------------
//  The Android layer runs a real tor daemon (guardianproject tor-android),
//  publishes this device's v3 Onion Service using the identity key supplied by
//  JS. Queues live only in Dexie (see onion-engine.ts).
//
//  There is NO web fallback: Tor hidden services cannot be hosted from a
//  browser sandbox. On the web build every call resolves to an "unavailable"
//  state and sealed frames stay in the Dexie outbox until the Android build
//  runs.
// ============================================================================

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { hasNativePlugin, isNative, platform } from "@/lib/platform";

export interface TorStatus {
  running: boolean;
  bootstrapped: boolean;
  bootstrapPercent: number;
  onion: string | null;
  socksPort: number;
  servicePort: number;
  lastError?: string | null;
}

export interface TorSendResult {
  delivered: boolean;
  reason?: string;
}

export interface TorInboundEvent {
  /** Raw JSON frame exactly as written by the remote onion service. */
  frame: string;
  receivedAt: number;
}

export interface TorTransportPlugin {
  /**
   * Boot tor + the foreground service and publish this device's onion service.
   * `secretKey` (optional) is an `ED25519-V3:<base64>` blob previously returned
   * by this call, so the same .onion address survives reinstall/restore.
   */
  start(options: {
    label?: string;
    secretKey?: string | null;
  }): Promise<TorStatus & { secretKey: string | null }>;
  stop(): Promise<void>;
  getStatus(): Promise<TorStatus>;
  /** Immediate synchronous-ish delivery attempt over the Tor SOCKS port. */
  send(options: { id: string; onion: string; frame: string }): Promise<TorSendResult>;
  /** TCP-reachability probe of a remote onion service through Tor. */
  probe(options: { onion: string }): Promise<{ reachable: boolean; rttMs: number }>;
  addListener(
    eventName: "onionMessage",
    listener: (event: TorInboundEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "onionStatus",
    listener: (event: TorStatus) => void,
  ): Promise<PluginListenerHandle>;
}

export const TorTransport = registerPlugin<TorTransportPlugin>("TorTransport");

export function isTorNativeAvailable(): boolean {
  return isNative() && platform() === "android" && hasNativePlugin("TorTransport");
}

export const TOR_UNAVAILABLE_STATUS: TorStatus = {
  running: false,
  bootstrapped: false,
  bootstrapPercent: 0,
  onion: null,
  socksPort: 0,
  servicePort: 0,
  lastError: "Tor transport requires the native Android build",
};
