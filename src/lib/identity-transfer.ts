import { dxdb, importDexieDump, type DexieDump } from "./dexie-db";
import { dbGetAllStrict } from "./storage";
import { getOrCreateIdentity, installRecoveredIdentity, type IdentityKeys } from "./crypto";
import { onionStopForAccountDeletion } from "./onion-engine";
import { TorTransport, isTorNativeAvailable } from "./tor-native";
import { validateBackupStructure } from "./backup-validation";

export interface TransferTargetCounts {
  contacts: number; messages: number; outbox: number; inbox: number;
  lifecycle: number; blobs: number; partialChunks: number; legacyMessages: number;
}

/** A transfer must not overwrite an established identity with real user data. */
export function assertEmptyTransferTarget(counts: TransferTargetCounts): void {
  if (Object.values(counts).some((value) => !Number.isSafeInteger(value) || value !== 0))
    throw new Error("Identity transfer requires a fresh installation with no existing conversations or contacts");
}

async function assertPristineDevice(): Promise<void> {
  const [contacts, messages, outbox, inbox, lifecycle, blobs, partialChunks, legacy] =
    await Promise.all([
      dxdb.contacts.count(), dxdb.messages.count(), dxdb.outbox.count(),
      dxdb.inbox_raw.count(), dxdb.lifecycle.count(), dxdb.blobs.count(),
      dxdb.partial_chunks.count(), dbGetAllStrict("messages"),
    ]);
  assertEmptyTransferTarget({
    contacts, messages, outbox, inbox, lifecycle, blobs,
    partialChunks, legacyMessages: legacy.length,
  });
  if (isTorNativeAvailable()) {
    // Do not throw away sealed frames for an identity that might have received
    // a message while the user was on the confirmation screen.
    const { entries } = await TorTransport.pendingInbound({ offset: 0 });
    if (entries.length) throw new Error("Pending Tor messages must be processed before replacing the identity");
  }
}

/**
 * Explicit, empty-device-only recovery. The database merge is atomic.
 * On a failed import restore the temporary identity, so the next launch is
 * not silently switched to a different sender.
 */
export async function restoreIdentityOnFreshDevice(
  newIdentity: IdentityKeys, dump: DexieDump,
): Promise<void> {
  validateBackupStructure(dump);
  await assertPristineDevice();
  await onionStopForAccountDeletion();
  await assertPristineDevice(); // recheck after transport has stopped
  const original = await getOrCreateIdentity();
  try {
    await installRecoveredIdentity(newIdentity);
    await importDexieDump(dump);
  } catch (error) {
    try {
      await installRecoveredIdentity(original);
    } catch (rollbackError) {
      throw new Error("Recovery failed and previous identity could not be restored", {
        cause: rollbackError,
      });
    }
    throw error;
  }
}
