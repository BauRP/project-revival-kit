import type { DexieDump } from "./dexie-db";
import type { IdentityKeys } from "./crypto";
import { validateBackupStructure } from "./backup-validation";
import { validatePortableChatPreferences, type PortableChatPreference } from "./backup-chat-preferences";

/**
 * Versioned plaintext format INSIDE the authenticated encrypted backup V2
 * envelope. Never store or transmit the plaintext package independently.
 */
export interface PortableBackupPackage {
  format: "TRIVO-PORTABLE-PACKAGE-V1";
  identity: IdentityKeys;
  database: DexieDump;
  /** Optional for archives created before Android chat settings encryption. */
  chatPreferences?: PortableChatPreference[];
}
export function makePortableBackupPackage(
  identity: IdentityKeys, database: DexieDump,
  chatPreferences?: PortableChatPreference[],
): PortableBackupPackage {
  validateBackupStructure(database);
  const portable = chatPreferences === undefined
    ? undefined : validatePortableChatPreferences(chatPreferences);
  return { format: "TRIVO-PORTABLE-PACKAGE-V1", identity, database,
    ...(portable === undefined ? {} : { chatPreferences: portable }) };
}

export function readPortableBackupPayload(
  value: unknown,
): { dump: DexieDump; identity: IdentityKeys | null; chatPreferences: PortableChatPreference[] } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid backup content");
  const candidate = value as Partial<PortableBackupPackage> & Partial<DexieDump>;
  if (candidate.format === "TRIVO-PORTABLE-PACKAGE-V1") {
    if (!candidate.identity) throw new Error("Backup does not contain an identity");
    validateBackupStructure(candidate.database);
    const chatPreferences = validatePortableChatPreferences(candidate.chatPreferences);
    return { dump: candidate.database as DexieDump, identity: candidate.identity,
      chatPreferences };
  }
  // Old encrypted V2 / legacy V1 backups contain only the Dexie dump. Keep
  // backwards compatibility without pretending that identity was recovered.
  validateBackupStructure(value);
  return { dump: value as DexieDump, identity: null, chatPreferences: [] };
}

/** Never silently merge another person's chats into this device identity. */
export function assertMatchingBackupIdentity(
  backup: IdentityKeys, device: IdentityKeys,
): void {
  if (backup.signing.publicKey !== device.signing.publicKey ||
      backup.exchange.publicKey !== device.exchange.publicKey)
    throw new Error(
      "Backup belongs to a different Trivo identity. Account transfer requires a separate verified recovery flow; no keys were replaced.",
    );
}
