/**
 * Bound each Tor resynchronization request to a small, rotating page.
 * A 1 GB attachment spans ~22,000 chunks; requesting every missing index
 * every 5 seconds would monopolize the event loop and flood Tor.
 */
import { MAX_MEDIA_CHUNKS } from "./blob-request-policy";

export const MAX_MISSING_CHUNKS_PER_RETRY = 128;

export interface MissingChunkPage {
  missing: number[];
  nextCursor: number;
}

/** Progresses fairly through every missing index, wrapping after the end. */
/**
 * A resumed transfer should start at the first missing piece, not at zero.
 * Bound the "have" list to the first 128-piece window for older peers.
 */
export function initialTransferWindow(
  totalChunks: number | null,
  received: ReadonlySet<number>,
): { windowStart: number; windowCount: number; have: number[] } {
  if (totalChunks === null) return { windowStart: 0, windowCount: 128, have: [] };
  const start = nextMissingChunkPage(totalChunks, received, 0, 1).missing[0] ?? 0;
  const windowCount = Math.min(128, totalChunks - start);
  const have: number[] = [];
  for (let i = start; i < start + windowCount; i++) {
    if (received.has(i)) have.push(i);
  }
  return { windowStart: start, windowCount, have };
}

export function nextMissingChunkPage(
  totalChunks: number,
  received: ReadonlySet<number>,
  cursor = 0,
  pageSize = MAX_MISSING_CHUNKS_PER_RETRY,
): MissingChunkPage {
  if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 ||
      totalChunks > MAX_MEDIA_CHUNKS ||
      !Number.isSafeInteger(cursor) || cursor < 0 || cursor >= totalChunks ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 ||
      pageSize > MAX_MISSING_CHUNKS_PER_RETRY)
    throw new Error("Invalid Tor media resynchronization window");

  const missing: number[] = [];
  let checked = 0;
  while (checked < totalChunks && missing.length < pageSize) {
    const index = (cursor + checked) % totalChunks;
    if (!received.has(index)) missing.push(index);
    checked++;
  }
  return { missing, nextCursor: (cursor + checked) % totalChunks };
}
