/**
 * Experimental basic cover traffic over the app's existing authenticated,
 * end-to-end encrypted Tor channel. No cloud relay and no Vuvuzela claims.
 * Never enabled without an explicit user choice. Only already-connected
 * trusted contacts can receive cover frames, and those are discarded.
 *
 * Traffic analysis resistance is LIMITED: timing/padding is not constant-rate,
 * it consumes network data and battery, and it cannot defeat a global observer.
 */
import { onionSendCoverFrame } from "./onion-engine";
const MIN_DELAY_MS = 60_000;
const JITTER_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let epoch = 0;
let noisePacketsSent = 0;

function randomDelay(): number {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return MIN_DELAY_MS + n % JITTER_MS;
}
async function sendActualCoverPacket(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  if (await onionSendCoverFrame()) noisePacketsSent++;
}
export function startNetworkNoise(): void {
  if (timer !== null) return;
  const generation = ++epoch;
  const tick = async () => {
    if (generation !== epoch) return;
    try {
      await sendActualCoverPacket();
    } catch (error) {
      console.warn("[stealth] optional Tor cover packet unavailable", error);
    } finally {
      if (generation === epoch) timer = setTimeout(() => void tick(), randomDelay());
    }
  };
  timer = setTimeout(() => void tick(), randomDelay());
}
export function stopNetworkNoise(): void {
  ++epoch;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
export function isNoiseActive(): boolean {
  return timer !== null;
}
export function getNoiseStats() {
  return {
    isActive: isNoiseActive(),
    packetsSent: noisePacketsSent,
    protocol: "Experimental Tor E2EE cover frames",
  };
}
export function sendTrackedNoisePacket(): void {
  void sendActualCoverPacket().catch((error) =>
    console.warn("[stealth] unable to send manual cover frame", error));
}

/**
 * A local text-splitting utility, NOT encrypted fragmentation and NOT
 * multi-path routing. If called on untrusted input, fail closed on missing,
 * duplicate or inconsistent parts instead of silently changing the message.
 */
export interface MessageFragment {
  fragmentId: string;
  messageId: string;
  index: number;
  total: number;
  data: string;
  timestamp: number;
}
export function fragmentMessage(
  messageId: string, text: string, chunkSize = 8,
): MessageFragment[] {
  if (!messageId || messageId.length > 128 ||
      !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 65_536 ||
      text.length > 200_000)
    throw new Error("Invalid text fragmentation request");
  const total = Math.ceil(text.length / chunkSize);
  return Array.from({length: total}, (_, index) => ({
    fragmentId: messageId + "-frag-" + index,
    messageId, index, total,
    data: text.slice(index * chunkSize, (index + 1) * chunkSize),
    timestamp: Date.now(),
  }));
}
export function reassembleFragments(fragments: MessageFragment[]): string {
  if (fragments.length === 0) return "";
  const first = fragments[0];
  if (!first || !Number.isSafeInteger(first.total) ||
      first.total <= 0 || first.total > 200_000 ||
      fragments.length !== first.total) throw new Error("Incomplete fragment set");
  const byIndex = new Map<number, string>();
  for (const part of fragments) {
    if (part.messageId !== first.messageId || part.total !== first.total ||
        !Number.isSafeInteger(part.index) || part.index < 0 || part.index >= first.total ||
        byIndex.has(part.index) || typeof part.data !== "string" ||
        part.data.length > 65_536) throw new Error("Invalid or duplicate fragment");
    byIndex.set(part.index, part.data);
  }
  const complete = Array.from({length: first.total}, (_, i) => byIndex.get(i));
  if (complete.some((s) => s === undefined)) throw new Error("Missing fragment");
  const result = complete.join("");
  if (result.length > 200_000) throw new Error("Oversized reassembled message");
  return result;
}
