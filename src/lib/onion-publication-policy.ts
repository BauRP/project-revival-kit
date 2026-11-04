import { isValidOnion, normalizeOnion } from "./onion-id";

/** Tor can be bootstrapping without a published address yet. Once published,
 * it must be exactly the onion derived from our verified local Ed25519 key.
 * Different addresses are never an acceptable best-effort fallback.
 */
export function matchesPublishedOnion(expected: string, published: string | null): boolean {
  if (!published) return true;
  return isValidOnion(expected) && isValidOnion(published) &&
    normalizeOnion(expected) === normalizeOnion(published);
}
