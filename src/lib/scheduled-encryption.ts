/**
 * Android scheduled messages stay ciphertext-only in IndexedDB until their
 * due time. The hardware-backed Keystore is the authority for the key.
 * Browser preview has no native Keystore and cannot promise at-rest secrecy.
 */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform";

const PREFIX = "TRIVO-SCHEDULED-V1:";
const vault = registerPlugin<{
  sealScheduledText(options: { plaintext: string }): Promise<{ sealed: string }>;
  openScheduledText(options: { sealed: string }): Promise<{ plaintext: string }>;
}>("SecureVault");

export function isSealedScheduledText(text: string): boolean {
  return typeof text === "string" && text.startsWith(PREFIX) && text.length > PREFIX.length;
}
export async function protectScheduledText(plaintext: string): Promise<string> {
  if (!isNative()) return plaintext;
  const { sealed } = await vault.sealScheduledText({ plaintext });
  if (!sealed || typeof sealed !== "string") throw new Error("Cannot encrypt scheduled message");
  return PREFIX + sealed;
}
export async function revealScheduledText(value: string): Promise<string> {
  if (!isSealedScheduledText(value)) return value; // legacy pre-encryption data
  if (!isNative()) throw new Error("Android Keystore required for scheduled message");
  const { plaintext } = await vault.openScheduledText({ sealed: value.slice(PREFIX.length) });
  if (typeof plaintext !== "string") throw new Error("Cannot decrypt scheduled message");
  return plaintext;
}
