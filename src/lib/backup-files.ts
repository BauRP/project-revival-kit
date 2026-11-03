/** Portable filename policy for safe, non-overwriting local backups. */
const LEGACY = "TrivoBackup.tvc";
const PREFIX = "TrivoBackup-";

export function createDatedBackupFilename(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid backup timestamp");
  // UTC ISO ordering naturally selects the newest backup; random suffix
  // prevents overwriting even when two copies are made in one second.
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(nonce, (x) => x.toString(16).padStart(2, "0")).join("");
  return PREFIX + stamp + "-" + suffix + ".tvc";
}
export function isSafeBackupFilename(name: string): boolean {
  return name === LEGACY ||
    /^TrivoBackup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}\.tvc$/.test(name);
}
export function newestBackupFilename(names: readonly string[]): string | null {
  const dated = names.filter((x) => x !== LEGACY && isSafeBackupFilename(x)).sort();
  return dated.at(-1) ?? (names.includes(LEGACY) ? LEGACY : null);
}
