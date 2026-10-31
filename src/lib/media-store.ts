// ============================================================================
//  Local media store. Uploads persist the blob in Dexie and return a stable
//  fileId; downloads read Dexie first and otherwise pull the blob from a peer
//  over the sealed Tor blob protocol (onion-engine.ts).
// ============================================================================

import { getBlob, putBlob } from "./dexie-db";
import { onionRequestBlob } from "./onion-engine";
import { compressImageIfNeeded } from "./image-compress";

export const TRIVO_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB ceiling

// ─── File "upload" / "download" — local Dexie only ───────────

export interface TrivoUploadResult {
  fileId: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadHandle {
  promise: Promise<TrivoUploadResult>;
  abort: () => void;
}

function makeFileId(): string {
  return `f_${crypto.randomUUID()}`;
}

/**
 * Persist the file blob locally in Dexie and return a stable fileId.
 * Progress reflects the real chunked copy into the local store.
 */
export function uploadFileToTrivo(
  file: File | Blob,
  filename?: string,
  onProgress?: (p: UploadProgress) => void,
): UploadHandle {
  let aborted = false;
  const fileId = makeFileId();

  const promise = (async (): Promise<TrivoUploadResult> => {
    // Step 1 — opportunistic on-the-fly compression for images.
    // Anything > 500 KB OR > 1080p is re-encoded down to ~300 KB before it
    // ever touches Dexie or the encryption layer.
    let working: File | Blob = file;
    if (typeof File !== "undefined" && file instanceof File) {
      try {
        working = await compressImageIfNeeded(file);
      } catch {
        working = file;
      }
    }

    const name = filename || (working as File).name || `upload-${Date.now()}.bin`;
    const mime = (working as File).type || "application/octet-stream";
    const total = working.size || 1;
    onProgress?.({ loaded: 0, total, percent: 0 });

    const CHUNK = 512 * 1024;
    let offset = 0;
    const parts: Blob[] = [];
    while (offset < working.size) {
      if (aborted) throw new Error("Upload aborted");
      const end = Math.min(offset + CHUNK, working.size);
      parts.push(working.slice(offset, end));
      offset = end;
      onProgress?.({
        loaded: offset,
        total,
        percent: total > 0 ? Math.min(100, (offset / total) * 100) : 100,
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    if (aborted) throw new Error("Upload aborted");

    const blob = new Blob(parts, { type: mime });
    await putBlob(fileId, blob, name, mime);
    onProgress?.({ loaded: total, total, percent: 100 });
    return { fileId };
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
    },
  };
}

const blobUrlCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/**
 * Resolve a fileId to a local blob URL. Order of attempts:
 *   1) URL already cached in this page session.
 *   2) Blob present in Dexie (sender side, or a previously received chunk set).
 *   3) Ask the original peer over the open RTCDataChannel.
 */
export function downloadFromTrivo(fileId: string): Promise<string> {
  if (!fileId) return Promise.reject(new Error("downloadFromTrivo: missing fileId"));
  const cached = blobUrlCache.get(fileId);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(fileId);
  if (pending) return pending;

  const task = (async (): Promise<string> => {
    const local = await getBlob(fileId);
    if (local) {
      const url = URL.createObjectURL(local.data);
      blobUrlCache.set(fileId, url);
      inFlight.delete(fileId);
      return url;
    }
    // Try to pull it from any open peer connection that has it.
    const ok = await onionRequestBlob(fileId).catch(() => false);
    inFlight.delete(fileId);
    if (!ok) throw new Error(`Blob ${fileId} not available locally or via peer`);
    const fetched = await getBlob(fileId);
    if (!fetched) throw new Error(`Blob ${fileId} not in Dexie after peer fetch`);
    const url = URL.createObjectURL(fetched.data);
    blobUrlCache.set(fileId, url);
    return url;
  })();

  inFlight.set(fileId, task);
  void task.finally(() => {
    if (inFlight.get(fileId) === task) inFlight.delete(fileId);
  }).catch(() => undefined);
  return task;
}

export async function ensureMediaUrl<T extends { fileId?: string; url?: string }>(
  media: T | null | undefined,
): Promise<T | null | undefined> {
  if (!media) return media;
  const needsResolve =
    !!media.fileId &&
    (!media.url ||
      media.url.startsWith("trivo://") ||
      media.url.length === 0 ||
      media.url.startsWith("blob:") === false);
  // Only fetch when we don't already have a usable local URL.
  if (!needsResolve && media.url) return media;
  if (!media.fileId) return media;
  try {
    const url = await downloadFromTrivo(media.fileId);
    (media as { url?: string }).url = url;
  } catch (e) {
    console.warn("[trivo] ensureMediaUrl failed", e);
  }
  return media;
}
