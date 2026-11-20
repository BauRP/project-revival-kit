/**
 * Crash-safe single-row history migration building block.
 *
 * This does NOT activate encrypted Dexie storage. The future adapter owns
 * the IndexedDB transaction implementing compareAndReplace. The key is
 * unlocked before this function runs; no WebCrypto promises are awaited
 * inside the IndexedDB write transaction.
 *
 * A migration is only complete after a committed reread authenticates its
 * ciphertext and exactly reproduces the original data. Crashes leave either
 * the original row or an independently decryptable encrypted row.
 */
import type { StoredMessage, LifecycleRecord } from "./dexie-db";
import {
  openHistoryMessage, openHistoryLifecycle, sealHistoryMessage, sealHistoryLifecycle,
  type ProtectedMessageRecord, type ProtectedLifecycleRecord,
} from "./protected-history-record";

export class HistoryMigrationConflictError extends Error {
  constructor() {
    super("History row changed while encryption was prepared");
    this.name = "HistoryMigrationConflictError";
  }
}

export interface HistoryRowMigrationIO<Legacy, Sealed> {
  /** Atomically replace only the EXACT previously read legacy row. */
  compareAndReplace: (expected: Legacy, prepared: Sealed) => Promise<boolean>;
  /** New independent read, after the write transaction has committed. */
  readCommitted: () => Promise<unknown>;
}

async function migrateOne<Legacy, Sealed>(
  original: Legacy,
  prepare: (row: Legacy) => Promise<Sealed>,
  open: (sealed: unknown) => Promise<Legacy>,
  io: HistoryRowMigrationIO<Legacy, Sealed>,
): Promise<void> {
  const prepared = await prepare(original);
  // Prove that the ciphertext can be opened, before replacing plaintext.
  const preparedOpened = await open(prepared);
  if (JSON.stringify(preparedOpened) !== JSON.stringify(original))
    throw new Error("Encrypted history row does not preserve source data");
  const replaced = await io.compareAndReplace(original, prepared);
  if (!replaced) throw new HistoryMigrationConflictError();
  const committed = await open(await io.readCommitted());
  if (JSON.stringify(committed) !== JSON.stringify(original))
    throw new Error("Committed encrypted history differs from source data");
}

export async function migrateHistoryMessageRow(
  key: CryptoKey,
  original: StoredMessage,
  io: HistoryRowMigrationIO<StoredMessage, ProtectedMessageRecord>,
): Promise<void> {
  return migrateOne(
    original, (row) => sealHistoryMessage(key, row),
    (row) => openHistoryMessage(key, row), io,
  );
}

export async function migrateHistoryLifecycleRow(
  key: CryptoKey,
  original: LifecycleRecord,
  io: HistoryRowMigrationIO<LifecycleRecord, ProtectedLifecycleRecord>,
): Promise<void> {
  return migrateOne(
    original, (row) => sealHistoryLifecycle(key, row),
    (row) => openHistoryLifecycle(key, row), io,
  );
}
