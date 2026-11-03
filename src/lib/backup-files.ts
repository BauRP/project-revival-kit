/** Timestamped manual and automatic archives have separate namespaces. */
const LEGACY = "TrivoBackup.tvc";
const PREFIX_MANUAL = "TrivoBackup-";
const PREFIX_AUTO = "TrivoAutoBackup-";
const NAME = /^(TrivoBackup|TrivoAutoBackup)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-f0-9]{8})\.tvc$/;

export function createDatedBackupFilename(
  date: Date = new Date(), kind: "manual" | "auto" = "manual",
): string {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid backup timestamp");
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(nonce, (x) => x.toString(16).padStart(2, "0")).join("");
  return (kind === "auto" ? PREFIX_AUTO : PREFIX_MANUAL) + stamp + "-" + suffix + ".tvc";
}
export function isSafeBackupFilename(name: string): boolean {
  return name === LEGACY || NAME.test(name);
}
export function isAutomaticBackupFilename(name: string): boolean {
  return NAME.exec(name)?.[1] === "TrivoAutoBackup";
}
function timestamp(name: string): string {
  return NAME.exec(name)?.[2] ?? "";
}
export function newestBackupFilename(names: readonly string[]): string | null {
  const dated = names.filter((x) => x !== LEGACY && isSafeBackupFilename(x))
    .sort((a, b) => timestamp(a).localeCompare(timestamp(b)) || a.localeCompare(b));
  return dated.at(-1) ?? (names.includes(LEGACY) ? LEGACY : null);
}
/** Only automatic archives are pruned; manual exports are user-controlled. */
export function automaticBackupsToPrune(names: readonly string[], keep = 7): string[] {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error("Invalid backup retention");
  const copies = names.filter(isAutomaticBackupFilename).sort((a, b) =>
    timestamp(b).localeCompare(timestamp(a)) || b.localeCompare(a));
  return copies.slice(keep);
}
