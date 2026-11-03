// Media upload service — now backed by the dedicated Trivo Node.js server.
// All images are scrubbed of EXIF/GPS/metadata before upload (zero-knowledge privacy).
import { TRIVO_MAX_UPLOAD_BYTES, uploadFileToTrivo, type UploadProgress } from "./media-store";

export interface MediaAttachment {
  id: string;
  /** Server-issued file identifier. Required to re-download with x-api-key. */
  fileId: string;
  type: "image" | "audio" | "file";
  /** Best-effort URL for local rendering. On the sender this is an object URL
   *  generated from the source file; on the receiver it is resolved lazily by
   *  `ensureMediaUrl()` (see trivo-server.ts) which fetches the file with the
   *  required x-api-key header and replaces this field with a blob URL. */
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void;
  /** Returns the abort handle from the underlying XHR so callers (UI cancel
   *  buttons) can stop an in-flight upload. */
  onHandle?: (abort: () => void) => void;
}

export async function uploadMedia(file: File, opts: UploadOptions = {}): Promise<MediaAttachment> {
  if (file.size > TRIVO_MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds 1 GB limit: ${formatFileSize(file.size)}`);
  }

  // All caller paths share validation and EXIF cleanup inside the store.
  const handle = uploadFileToTrivo(file, file.name, opts.onProgress);
  opts.onHandle?.(handle.abort);
  const { fileId, prepared, name, size, mimeType } = await handle.promise;
  const localUrl = URL.createObjectURL(prepared);

  return {
    id: fileId,
    fileId,
    type: getMediaType(mimeType),
    url: localUrl,
    name,
    size,
    mimeType,
  };
}

function getMediaType(mime: string): "image" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
