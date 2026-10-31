// One-click local backup & restore.
// Serializes the full Dexie DB, encrypts with NaCl secretbox (XSalsa20-Poly1305)
// keyed by SHA-512 of the supplied master password, and writes a .tvc file
// to the device's Documents directory via @capacitor/filesystem.
// On the web (no Capacitor runtime) we transparently fall back to a browser
// download / file input.

import nacl from "tweetnacl";
import { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } from "tweetnacl-util";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { exportDexieDump, importDexieDump, type DexieDump } from "./dexie-db";
import { isNative } from "./platform";

const FILE_NAME_DEFAULT = "TrivoBackup.tvc";
const MAGIC = "TRIVO-BACKUP-V1";

interface EncryptedEnvelope {
  magic: typeof MAGIC;
  nonce: string; // base64
  ciphertext: string; // base64
  createdAt: number;
}

function deriveKey(password: string): Uint8Array {
  // LEGACY V1 format only. Password mandatory; V2 should use Argon2id + salt.
  // Do not use this function for new unattended backups.
  if (!password || !password.trim()) throw new Error("Backup password is required");
  const hash = nacl.hash(decodeUTF8(password));
  return hash.slice(0, nacl.secretbox.keyLength);
}

function encryptDump(dump: DexieDump, password: string): EncryptedEnvelope {
  const key = deriveKey(password);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = decodeUTF8(JSON.stringify(dump));
  const ct = nacl.secretbox(plaintext, nonce, key);
  return {
    magic: MAGIC,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(ct),
    createdAt: Date.now(),
  };
}

function decryptDump(env: EncryptedEnvelope, password: string): DexieDump {
  if (!env || env.magic !== MAGIC) throw new Error("Not a Trivo backup file");
  const key = deriveKey(password);
  const nonce = decodeBase64(env.nonce);
  const ct = decodeBase64(env.ciphertext);
  const plain = nacl.secretbox.open(ct, nonce, key);
  if (!plain) throw new Error("Wrong password or corrupted backup");
  return JSON.parse(encodeUTF8(plain)) as DexieDump;
}

export interface BackupExportResult {
  written: "native" | "download";
  path?: string;
  filename: string;
}

/**
 * Export the local Dexie DB to an encrypted .tvc file in Documents.
 * Returns the path/filename of what was written.
 */
export async function exportBackup(
  password: string,
  filename: string = FILE_NAME_DEFAULT,
): Promise<BackupExportResult> {
  const dump = await exportDexieDump();
  const envelope = encryptDump(dump, password);
  const json = JSON.stringify(envelope);

  if (isNative()) {
    const res = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return { written: "native", path: res.uri, filename };
  }

  // Browser fallback: trigger a download.
  const blob = new Blob([json], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { written: "download", filename };
}

/**
 * Restore the local Dexie DB from a .tvc file. On native platforms we read
 * `filename` from Documents; on the web we open a file picker.
 */
export async function importBackup(
  password: string,
  filename: string = FILE_NAME_DEFAULT,
): Promise<void> {
  let json: string;

  if (isNative()) {
    const res = await Filesystem.readFile({
      path: filename,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    json = typeof res.data === "string" ? res.data : await (res.data as Blob).text();
  } else {
    json = await pickFileAsText();
  }

  const envelope = JSON.parse(json) as EncryptedEnvelope;
  const dump = decryptDump(envelope, password);
  await importDexieDump(dump);
}

function pickFileAsText(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tvc,application/octet-stream,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }
      try {
        const text = await file.text();
        resolve(text);
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
