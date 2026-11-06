/** Friend events require a second durable IndexedDB transaction before ACK. */
export function isLegacyFriendEvent(type: string): boolean {
  return type === "friend_request" || type === "friend_request_status";
}

/**
 * Only deterministic authenticated-frame validation failures are disposable.
 * Worker crashes, storage failures and failed identity access are transient:
 * they must leave the encrypted frame in inbox_raw for retry after restart.
 */
export function isPermanentlyInvalidInboundFrame(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "Invalid decrypted frame" ||
      error.message === "Invalid decrypted frame body") return true;
  return error.message === "open: unsupported frame version" ||
    error.message === "open: frame not addressed to this device" ||
    error.message === "open: invalid sender onion address" ||
    error.message === "open: signature verification failed" ||
    error.message === "open: decryption failed" ||
    error.message === "open: malformed decrypted JSON";
}

/** The signature-derived inbox primary key does not permit another raw body
 * to overwrite a still-unprocessed ciphertext. Replayed identical raw frames
 * remain valid and must get their durable ACK after idempotent processing.
 */
export function canReuseInboundRawId(
  previousRaw: string | undefined, arrivingRaw: string,
): boolean {
  return previousRaw === undefined || previousRaw === arrivingRaw;
}
