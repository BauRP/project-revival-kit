/**
 * Android at-rest protection for the Dexie contacts directory.
 * The .onion primary key and lastSeen index remain visible because the
 * transport needs them; displayName is encrypted with the device Keystore
 * master key. This does NOT encrypt messages or lifecycle records.
 *
 * No WebCrypto promises are awaited inside Dexie write transactions.
 */
import type { ContactRecord } from "./dexie-db";
import { sealLocalRecord, openLocalRecord, type SealedLocalRecord } from "./local-record-crypto";

export const DEXIE_CONTACT_NAME_KIND = "trivo-dexie-contact-name-v1";
const TABLE_AAD = "dexie_contacts";

export interface ProtectedContactName {
  kind: typeof DEXIE_CONTACT_NAME_KIND;
  sealed: SealedLocalRecord;
}
export interface StoredContactRecord extends ContactRecord {
  protectedName?: ProtectedContactName;
}

export function hasProtectedDexieContactName(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    "protectedName" in value;
}

function assertContact(value: ContactRecord): void {
  if (!value || typeof value.onion !== "string" ||
      value.onion.length < 1 || value.onion.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(value.onion))
    throw new Error("Invalid local Dexie contact identity");
  if (value.displayName !== undefined &&
      (typeof value.displayName !== "string" || value.displayName.length > 512))
    throw new Error("Invalid local contact name");
}

export function sameStoredContact(
  a: StoredContactRecord | undefined, b: StoredContactRecord | undefined,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function sealDexieContact(
  key: CryptoKey, original: ContactRecord,
): Promise<StoredContactRecord> {
  assertContact(original);
  const { displayName, ...publicFields } = original;
  // Never copy an untrusted ciphertext or stale plaintext from a caller.
  delete (publicFields as StoredContactRecord).protectedName;
  if (displayName === undefined) return publicFields;
  return {
    ...publicFields,
    protectedName: {
      kind: DEXIE_CONTACT_NAME_KIND,
      sealed: await sealLocalRecord(key, TABLE_AAD, original.onion, displayName),
    },
  };
}

export async function openDexieContact(
  key: CryptoKey, stored: StoredContactRecord,
): Promise<ContactRecord> {
  if (!stored || typeof stored !== "object")
    throw new Error("Invalid stored Dexie contact");
  const { protectedName, ...rest } = stored;
  assertContact(rest);
  if (!hasProtectedDexieContactName(stored)) return rest;
  if (Object.prototype.hasOwnProperty.call(stored, "displayName"))
    throw new Error("Protected contact retains plaintext name");
  if (!protectedName || protectedName.kind !== DEXIE_CONTACT_NAME_KIND ||
      !protectedName.sealed)
    throw new Error("Invalid protected Dexie contact envelope");
  const displayName = await openLocalRecord(
    key, TABLE_AAD, rest.onion, protectedName.sealed,
  );
  const result: ContactRecord = { ...rest, displayName };
  assertContact(result);
  return result;
}
