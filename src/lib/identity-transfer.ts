import { dxdb, importDexieDump, type DexieDump } from "./dexie-db";
import { dbReadBatchStrict, dbHasKeyPrefixStrict } from "./storage";
import { countScheduledOutbox } from "./outbox";
import { getOrCreateIdentity, installRecoveredIdentity, type IdentityKeys } from "./crypto";
import { onionStopForAccountDeletion } from "./onion-engine";
import { TorTransport, isTorNativeAvailable } from "./tor-native";
import { validateBackupStructure } from "./backup-validation";
import { isBuiltInWelcomeMessage, isBuiltInSupportContact } from "./transfer-pristine-policy";

export interface TransferTargetCounts {
  contacts: number; messages: number; outbox: number; inbox: number;
  lifecycle: number; blobs: number; partialChunks: number;
  legacyMessages: number; legacyContacts: number; scheduledMessages: number; nativeFrames: number;
  chatPreferences: number;
}

/** A transfer must not overwrite an established identity with real user data. */
export function assertEmptyTransferTarget(counts: TransferTargetCounts): void {
  if (Object.values(counts).some((value) => !Number.isSafeInteger(value) || value !== 0))
    throw new Error("Identity transfer requires a fresh installation with no existing conversations or contacts");
}

/** For identity safety we only need to know whether ANY non-fixture
 * legacy record exists. Avoid cloning the full plaintext history in RAM.
 * Fail closed on cursor errors or unsupported legacy record shapes.
 */
async function hasNonFixtureLegacyRecords(
  store: "messages" | "contacts",
  isFixture: (value: unknown) => boolean,
): Promise<boolean> {
  let lastKey: IDBValidKey | undefined;
  for (;;) {
    const rows = await dbReadBatchStrict<unknown>(store, lastKey, 128);
    if (rows.some(({ value }) => !isFixture(value))) return true;
    if (rows.length < 128) return false;
    lastKey = rows[rows.length - 1].key;
  }
}

async function assertPristineDevice(): Promise<void> {
  const [contacts, messages, outbox, inbox, lifecycle, blobs, partialChunks, legacy,
    legacyContacts, schedules, chatPreferences] = await Promise.all([
      dxdb.contacts.count(), dxdb.messages.filter((message) =>
        !isBuiltInWelcomeMessage(message)).count(), dxdb.outbox.count(),
      dxdb.inbox_raw.count(), dxdb.lifecycle.count(), dxdb.blobs.count(),
      dxdb.partial_chunks.count(), hasNonFixtureLegacyRecords("messages", isBuiltInWelcomeMessage),
      hasNonFixtureLegacyRecords("contacts", isBuiltInSupportContact), countScheduledOutbox(),
      // An apparently unused install with stored privacy preferences is NOT
      // safe for replacing the identity. Includes sealed Android rows.
      dbHasKeyPrefixStrict("settings", "chat-preferences-"),
    ]);
  // Native count includes damaged frames which cannot be decoded by
  // pendingInbound(); do not let such frames survive a key replacement.
  const nativeFrames = isTorNativeAvailable() ? (await TorTransport.inboundCount()).count : 0;
  // First launch creates a local-only support welcome before the user can
  // open the restore screen. It is not another real identity/conversation.
  // Ignore ONLY that exact built-in fixture. Any user reply or real contact
  // still makes the target nonempty and forbids identity replacement.
  assertEmptyTransferTarget({
    contacts,
    messages,
    outbox, inbox, lifecycle, blobs,
    partialChunks,
    legacyMessages: legacy ? 1 : 0,
    legacyContacts: legacyContacts ? 1 : 0,
    scheduledMessages: schedules,
    nativeFrames,
    chatPreferences: chatPreferences ? 1 : 0,
  });
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
