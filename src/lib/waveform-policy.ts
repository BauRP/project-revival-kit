/**
 * Safe best-effort voice waveform sampling. This is a preview only:
 * exceeding the budget does not stop native HTMLAudioElement playback.
 */
export const WAVEFORM_MAX_BYTES = 8 * 1024 * 1024;

/** Never fetch a private message's third-party URL just to draw the waveform. */
export function canReadWaveformLocally(src: string, pageOrigin: string): boolean {
  try {
    const url = new URL(src, pageOrigin);
    if (url.protocol === "data:") return /^data:audio\//i.test(src);
    if (url.protocol !== "blob:" && url.protocol !== "http:" &&
        url.protocol !== "https:") return false;
    return url.origin === new URL(pageOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * Abort streaming as soon as the byte budget is reached. Do not use
 * response.arrayBuffer() on an untrusted length (it buffers everything).
 * null means "draw approximate bars", not a playback failure.
 */
export async function readBoundedWaveformBytes(
  response: Response, limit = WAVEFORM_MAX_BYTES,
): Promise<ArrayBuffer | null> {
  if (!response.ok || !Number.isSafeInteger(limit) || limit < 1) return null;
  const declared = response.headers.get("content-length");
  if (declared !== null && (/^\d+$/.test(declared) && Number(declared) > limit))
    return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) return null;
  const result = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.byteLength;
  }
  return result.buffer;
}
