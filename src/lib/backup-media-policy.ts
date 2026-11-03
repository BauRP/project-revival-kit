import type { StoredMessage } from "./dexie-db";

/**
 * Object URLs belong to one browser session, not the exported database.
 * They may also contain untrusted local or remote URLs in old backups.
 * Only the opaque fileId is portable; the media store resolves it locally.
 */
export function stripSessionMediaUrl<T extends StoredMessage>(msg: T): T {
  const media = msg.media;
  if (!media || typeof media !== "object" || Array.isArray(media)) return msg;
  return { ...msg, media: { ...(media as Record<string, unknown>), url: "" } };
}
