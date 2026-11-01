/** Local one-time attachment identity and replay prevention keys. */
export function consumedMediaKey(fileId: string): string {
  if (!fileId || fileId.length > 256) throw new Error("Invalid one-time media ID");
  return `consumed-media::${fileId}`;
}
export function isConsumedMediaRecord(data: unknown): boolean {
  return !!data && typeof data === "object" &&
    (data as { consumed?: unknown }).consumed === true;
}
