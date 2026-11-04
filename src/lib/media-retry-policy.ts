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
