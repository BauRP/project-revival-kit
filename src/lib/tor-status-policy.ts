import type { TorStatus } from "./tor-native";
import { isValidOnion } from "./onion-id";

/** A published-looking address alone does not prove Tor is actually usable. */
export function isTorServiceReady(status: TorStatus): boolean {
  return status.running === true &&
    status.bootstrapped === true &&
    status.bootstrapPercent === 100 &&
    typeof status.onion === "string" &&
    /^[a-z2-7]{56}\.onion$/.test(status.onion) &&
    isValidOnion(status.onion) &&
    Number.isSafeInteger(status.socksPort) &&
    status.socksPort > 0 && status.socksPort <= 65535 &&
    Number.isSafeInteger(status.servicePort) &&
    status.servicePort > 0 && status.servicePort <= 65535 &&
    !status.lastError;
}
