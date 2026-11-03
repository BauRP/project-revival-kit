/**
 * Opt-in, offline automatic encrypted backups. A recovery passphrase is never
 * persisted unencrypted: SecureVault wraps it using Android Keystore.
 *
 * Snapshots run only when the Android WebView is alive and visible, including
 * reopening the application. Android WorkManager is NOT implemented here.
 */
import { registerPlugin } from "@capacitor/core";
import { dbGetStrict, dbPutStrict } from "./storage";
import { isNative } from "./platform";
import { getTotalBlobBytes } from "./dexie-db";
import { exportBackup } from "./backup";

const KEY = "trivo-auto-backup-v1";
export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_WAIT_MS = 15 * 60 * 1000;
// A giant snapshot can exhaust a mobile WebView: permit explicit/manual
// backups but do not attempt gigantic work automatically after startup.
const AUTO_MEDIA_LIMIT = 192 * 1024 * 1024;

interface AutoBackupState {
  sealed: string;
  lastSavedAt: number;
}
const vault = registerPlugin<{
  sealIdentity(options: { plaintext: string }): Promise<{ sealed: string }>;
  openIdentity(options: { sealed: string }): Promise<{ plaintext: string }>;
}>("SecureVault");

function isAutoBackupState(x: unknown): x is AutoBackupState {
  return !!x && typeof x === "object" && typeof (x as AutoBackupState).sealed === "string" &&
    Number.isSafeInteger((x as AutoBackupState).lastSavedAt);
}
export function shouldRunAutomaticBackup(lastSavedAt: number, now = Date.now()): boolean {
  return Number.isSafeInteger(lastSavedAt) && lastSavedAt >= 0 &&
    now >= lastSavedAt + AUTO_BACKUP_INTERVAL_MS;
}
export async function isAutomaticBackupEnabled(): Promise<boolean> {
  if (!isNative()) return false;
  return isAutoBackupState(await dbGetStrict<unknown>("settings", KEY));
}

/** Call only AFTER the initial password-encrypted portable backup succeeded. */
export async function enableAutomaticBackups(password: string): Promise<void> {
  if (!isNative()) throw new Error("Automatic encrypted copies require the Android app");
  if (password.trim().length < 12 || password.length > 1024)
    throw new Error("A recovery password of 12–1024 characters is required");
  const { sealed } = await vault.sealIdentity({ plaintext: password });
  await dbPutStrict("settings", KEY, { sealed, lastSavedAt: Date.now() } satisfies AutoBackupState);
}

export async function disableAutomaticBackups(): Promise<void> {
  await dbPutStrict("settings", KEY, null);
}

let running: Promise<void> | null = null;
let lastFailedAt = 0;
export function runAutomaticBackupIfDue(): Promise<void> {
  if (running) return running;
  const work = (async () => {
    if (!isNative() || typeof document === "undefined" || document.hidden) return;
    const now = Date.now();
    if (lastFailedAt && now - lastFailedAt < RETRY_WAIT_MS) return;
    const state = await dbGetStrict<unknown>("settings", KEY);
    if (!isAutoBackupState(state) || !shouldRunAutomaticBackup(state.lastSavedAt, now)) return;
    try {
      // Read only the tiny sealed credential, not cleartext from settings.
      const { plaintext } = await vault.openIdentity({ sealed: state.sealed });
      if (plaintext.trim().length < 12 || plaintext.length > 1024)
        throw new Error("Stored backup credential is invalid");
      if (await getTotalBlobBytes() > AUTO_MEDIA_LIMIT)
        throw new Error("Automatic backup skipped: media exceeds safe memory limit");
      await exportBackup(plaintext);
      // Update only after the encrypted file has been written successfully.
      await dbPutStrict("settings", KEY, { ...state, lastSavedAt: Date.now() });
      lastFailedAt = 0;
    } catch (error) {
      lastFailedAt = Date.now();
      console.warn("[backup] automatic encrypted snapshot unavailable:", error);
    }
  })();
  running = work;
  void work.finally(() => { if (running === work) running = null; }).catch(() => undefined);
  return work;
}

export function startAutomaticBackupMonitor(): () => void {
  if (!isNative() || typeof window === "undefined") return () => {};
  const run = () => { void runAutomaticBackupIfDue().catch((error) =>
    console.warn("[backup] unable to check snapshot schedule", error)); };
  const initial = window.setTimeout(run, 12_000);
  const timer = window.setInterval(run, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", run);
  return () => {
    window.clearTimeout(initial);
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", run);
  };
}
