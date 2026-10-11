// The user's only identifier is the v3 .onion address derived from their
// locally generated Ed25519 key. No accounts, phone numbers or servers.
import { getOrCreateIdentity } from "./crypto";
import { onionFromPublicKey, isValidOnion } from "./onion-id";

export { isValidOnion };

export async function getOrCreateUserId(): Promise<string> {
  const keys = await getOrCreateIdentity();
  return onionFromPublicKey(keys.signing.publicKey);
}
