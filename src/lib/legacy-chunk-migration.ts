/** An already verified legacy Tor transfer may be upgraded in-place only
 * when the persisted row is still the one that was validated. If another
 * download, deletion or one-time purge intervened, do not recreate its data.
 */
export interface LegacyChunkSnapshot {
  key: string;
  fileId: string;
  from: string;
  index: number;
  digest: string;
  updatedAt: number;
  encrypted?: 1;
  data: Blob;
}
export function mayUpgradeLegacyChunk(
  original: LegacyChunkSnapshot, current: LegacyChunkSnapshot | undefined,
): boolean {
  return !!current &&
    current.encrypted === undefined && original.encrypted === undefined &&
    current.key === original.key &&
    current.fileId === original.fileId &&
    current.from === original.from &&
    current.index === original.index &&
    current.digest === original.digest &&
    current.updatedAt === original.updatedAt &&
    current.data.size === original.data.size &&
    current.data.type === original.data.type;
}
