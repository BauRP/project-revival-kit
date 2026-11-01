/**
 * Strict boundary between authenticated remote JSON and our local Dexie schema.
 * The signature authenticates the peer, but never makes arbitrary JSON safe.
 */
export interface ValidatedIncomingMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  status: "delivered";
  media?: {
    id: string;
    fileId: string;
    type: "image" | "audio" | "file" | "video";
    url: "";
    name: string;
    size: number;
    mimeType: string;
  };
  caption?: string;
  deleteAt?: number;
  silent?: boolean;
  oneTimeView?: boolean;
  roundVideo?: boolean;
}

export function validateIncomingTextMessage(
  payload: Record<string, unknown>,
  now = Date.now(),
): ValidatedIncomingMessage | null {
  const id = payload.id;
  const from = payload.from;
  const to = payload.to;
  const text = payload.text;
  const timestamp = payload.timestamp;
  if (typeof id !== "string" || !id || id.length > 128 ||
      typeof from !== "string" || !from.endsWith(".onion") || from.length !== 62 ||
      typeof to !== "string" || !to.endsWith(".onion") || to.length !== 62 ||
      from === to || typeof text !== "string" || text.length > 200_000 ||
      typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 || timestamp > now + 10 * 60_000) return null;

  const result: ValidatedIncomingMessage = {
    id, from, to, text, timestamp, status: "delivered",
  };

  if (payload.media !== undefined) {
    const raw = payload.media;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.fileId !== "string" || !m.fileId || m.fileId.length > 128 ||
        typeof m.id !== "string" || m.id.length > 128 ||
        !["image", "audio", "file", "video"].includes(String(m.type)) ||
        typeof m.name !== "string" || m.name.length > 255 ||
        typeof m.mimeType !== "string" || m.mimeType.length > 128 ||
        typeof m.size !== "number" || !Number.isSafeInteger(m.size) ||
        m.size < 0 || m.size > 1024 * 1024 * 1024) return null;
    result.media = {
      id: m.id, fileId: m.fileId,
      type: m.type as "image" | "audio" | "file" | "video",
      url: "", // do not persist remote network or file: URLs
      name: m.name, size: m.size, mimeType: m.mimeType,
    };
  }

  if (payload.caption !== undefined) {
    if (typeof payload.caption !== "string" || payload.caption.length > 10_000) return null;
    result.caption = payload.caption;
  }
  if (payload.deleteAt !== undefined) {
    if (typeof payload.deleteAt !== "number" || !Number.isSafeInteger(payload.deleteAt) ||
        payload.deleteAt <= 0) return null;
    result.deleteAt = payload.deleteAt;
  }
  for (const key of ["silent", "oneTimeView", "roundVideo"] as const) {
    if (payload[key] !== undefined) {
      if (typeof payload[key] !== "boolean") return null;
      result[key] = payload[key];
    }
  }
  return result;
}
