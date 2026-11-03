/**
 * A missing key record is not evidence of a new installation. A damaged or
 * partially cleared Keystore/IndexedDB must never silently create another
 * onion identity alongside existing conversations, attachments or contacts.
 */
export interface IdentityBootstrapCounts {
  contacts: number;
  messages: number;
  outbox: number;
  inbound: number;
  lifecycle: number;
  blobs: number;
  chunks: number;
  legacyContacts: number;
  legacyMessages: number;
  scheduledMessages: number;
  nativeFrames: number;
}
export function assertCanGenerateNewIdentity(counts: IdentityBootstrapCounts): void {
  if (Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("Cannot verify existing Trivo data before generating identity");
  if (Object.values(counts).some((n) => n > 0))
    throw new Error("Existing Trivo data detected but the identity key is missing. Restore the original identity; a replacement onion address was NOT generated.");
}
