/**
 * Stream bounded chunks for the existing V3 portable backup JSON format.
 * Keep chunk sizes divisible by 3 bytes (and thus 4 Base64 chars), so the
 * concatenation remains EXACTLY the legacy encoded file representation.
 * No additional dependencies, no change to on-disk backup compatibility.
 */
const BASE64_CHUNK_BYTES = 3 * 32 * 1024;
const BASE64_CHUNK_CHARS = (BASE64_CHUNK_BYTES / 3) * 4;

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return text;
}

export async function encodePortableMedia(blob: Blob): Promise<string> {
  if (!(blob instanceof Blob)) throw new Error("Invalid backup Blob");
  const segments: string[] = [];
  for (let offset = 0; offset < blob.size; offset += BASE64_CHUNK_BYTES) {
    const part = new Uint8Array(await blob.slice(
      offset, Math.min(blob.size, offset + BASE64_CHUNK_BYTES),
    ).arrayBuffer());
    segments.push(btoa(latin1(part)));
  }
  return segments.join("");
}

/** Decodes at most 96 KiB of temporary data at a time (not the full media). */
export function decodePortableMedia(encoded: string, mime: string): Blob {
  if (typeof encoded !== "string") throw new Error("Invalid backup attachment");
  if (encoded.length % 4 !== 0) throw new Error("Invalid backup Base64 alignment");
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < encoded.length; offset += BASE64_CHUNK_CHARS) {
    let segment: string;
    try { segment = atob(encoded.slice(offset, offset + BASE64_CHUNK_CHARS)); }
    catch { throw new Error("Invalid backup Base64 data"); }
    const bytes = new Uint8Array(segment.length);
    for (let i = 0; i < segment.length; i++) bytes[i] = segment.charCodeAt(i);
    parts.push(bytes);
  }
  return new Blob(parts, { type: mime });
}
