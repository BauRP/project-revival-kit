/** Pure validation for an incomplete, authenticated Tor media transfer.
 * Reject mismatched metadata, duplicates, missing indexes or huge manifests
 * before attempting to construct a browser Blob from persisted chunks.
 */
export const MAX_MEDIA_CHUNKS = Math.ceil((1024 * 1024 * 1024) / (48 * 1024));
export const MEDIA_CHUNK_SIZE = 48 * 1024;
export interface MediaChunkDescriptor {
  fileId: string;
  from: string;
  index: number;
  totalChunks: number;
  name: string;
  mimeType: string;
  size: number;
}
export function orderedCompleteChunkSet<T extends MediaChunkDescriptor>(
  records: T[], fileId: string, from: string,
): T[] | null {
  if (!records.length) return null;
  const head = records[0];
  if (!Number.isSafeInteger(head.totalChunks) || head.totalChunks < 1 ||
      head.totalChunks > MAX_MEDIA_CHUNKS || records.length !== head.totalChunks ||
      !head.name || head.name.length > 255 || !head.mimeType ||
      head.mimeType.length > 128) return null;
  const positions = new Array<T | undefined>(head.totalChunks);
  for (const row of records) {
    if (row.fileId !== fileId || row.from !== from || row.name !== head.name ||
        row.mimeType !== head.mimeType || row.totalChunks !== head.totalChunks ||
        !Number.isSafeInteger(row.index) || row.index < 0 ||
        row.index >= head.totalChunks || positions[row.index] ||
        !Number.isSafeInteger(row.size) || row.size < 0 ||
        row.size > MEDIA_CHUNK_SIZE ||
        (row.index !== head.totalChunks - 1 && row.size !== MEDIA_CHUNK_SIZE))
      return null;
    positions[row.index] = row;
  }
  return positions.every((row) => row !== undefined) ? positions as T[] : null;
}
