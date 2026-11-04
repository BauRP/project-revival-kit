import type { TorStatus } from "./tor-native";
import { isValidOnion } from "./onion-id";

/** A published-looking address alone does not prove Tor is actually usable. */
export function isTorServiceReady(status: TorStatus): boolean {
  return status.running === true &&
    status.bootstrapped === true &&
    status.bootstrapPercent >= 100 &&
    typeof status.onion === "string" &&
    isValidOnion(status.onion) &&
    !status.lastError;
}
