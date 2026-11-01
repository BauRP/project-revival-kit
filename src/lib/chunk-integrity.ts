import nacl from "tweetnacl";

/** SHA-512 of one decoded media chunk, hex encoded. This detects accidental
 * corruption and conflicting replays before the bytes enter the attachment.
 * Authentication still comes from the signed and sealed Tor envelope.
 */
export function chunkDigest(bytes: Uint8Array): string {
  return Array.from(nacl.hash(bytes)).map((n) => n.toString(16).padStart(2, "0")).join("");
}
export function matchesChunkDigest(bytes: Uint8Array, candidate: unknown): boolean {
  if (typeof candidate !== "string" || !/^[0-9a-f]{128}$/.test(candidate)) return false;
  const actual = chunkDigest(bytes);
  let difference = 0;
  for (let i = 0; i < 128; i++) difference |= actual.charCodeAt(i) ^ candidate.charCodeAt(i);
  return difference === 0;
}
