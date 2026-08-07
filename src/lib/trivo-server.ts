// ============================================================================
//  Trivo Elite — ZERO-SERVER local shim.
//  ---------------------------------------------------------------------------
//  The dedicated ngrok Node.js backend has been removed. This file preserves
//  the public API consumed by the rest of the app (uploadFileToTrivo,
//  downloadFromTrivo, ensureMediaUrl, sendTrivoTextMessage, onTrivoMessage,
//  initTrivoServer, isTrivoConnected, TRIVO_MAX_UPLOAD_BYTES) but every byte
//  is now handled locally through Dexie + the WebRTC P2P engine.
//
//  - "uploads" simply persist the blob in Dexie and return a stable fileId.
//  - "downloads" read from Dexie; if missing, request it from the peer over
//    the open RTCDataChannel.
//  - "text" frames are routed through the P2P engine; if the peer isn't live
//    they go into the Dexie pending_messages queue and drain on connect.
// ============================================================================

import {
  enqueuePending,
  getBlob,
  putBlob,
  startMediaCacheMonitor,
  type PendingPayloadKind,
} from "./dexie-db";
import {
  rtcSendDispatch,
  rtcRequestBlob,
  rtcIsConnectedTo,
  rtcRegisterIncomingListener,
} from "./onion-engine";
import { compressImageIfNeeded } from "./image-compress";

export const TRIVO_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB ceiling

// ─── Inbound dispatch listeners (kept identical to old WS contract) ──

type IncomingHandler = (payload: any) => void;
const listeners = new Set<IncomingHandler>();

export function onTrivoMessage(cb: IncomingHandler): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function dispatchInbound(payload: any): void {
  if (!payload || typeof payload !== "object") return;
  listeners.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      /* swallow */
    }
  });
}

// The WebRTC engine forwards every "trivo_dispatch" frame here.
rtcRegisterIncomingListener(dispatchInbound);

// ─── Connection lifecycle (now a no-op — PeerJS owns it) ─────

let currentUserId: string | null = null;

export function initTrivoServer(userId: string): void {
  if (userId) currentUserId = userId;
  // Kick off the 3 GiB media-cache watchdog (idempotent — first call wins).
  startMediaCacheMonitor();
}

export function isTrivoConnected(): boolean {
  // Without a central server "connected" means we at least have an identity.
  return !!currentUserId;
}

// ─── Outbound dispatch ───────────────────────────────────────

const TRIVO_KIND_WHITELIST: PendingPayloadKind[] = [
  "text_message",
  "friend_request",
  "friend_request_status",
  "message_status",
  "message_lifecycle",
];

function coerceKind(payload: Record<string, unknown>): PendingPayloadKind {
  const t = typeof payload.type === "string" ? (payload.type as string) : "text_message";
  return (TRIVO_KIND_WHITELIST as string[]).includes(t)
    ? (t as PendingPayloadKind)
    : "text_message";
}

/**
 * Send a frame to the peer. If a live RTCDataChannel exists the frame is
 * shipped immediately; otherwise it is persisted in the Dexie
 * pending_messages queue and the WebRTC engine drains it on (re)connect.
 *
 * Returns `true` when handed to the live channel, `false` when queued.
 */
export function sendTrivoTextMessage(payload: Record<string, unknown>): boolean {
  const envelope: Record<string, unknown> = {
    ...payload,
    type: typeof payload.type === "string" ? payload.type : "text_message",
  };
  const targetUserId = String((envelope.to as string | undefined) || "").trim();
  const senderUserId = String((envelope.from as string | undefined) || currentUserId || "").trim();
  if (!targetUserId) return false;

  if (rtcIsConnectedTo(targetUserId)) {
    const ok = rtcSendDispatch(targetUserId, envelope);
    if (ok) return true;
  }

  // Queue for later drain.
  const id =
    (envelope.id as string | undefined) ||
    `pend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const media = envelope.media as { fileId?: string } | undefined;
  void enqueuePending({
    id,
    targetUserId,
    senderUserId,
    kind: coerceKind(envelope),
    payload: envelope,
    blobFileId: typeof media?.fileId === "string" ? media.fileId : undefined,
  });
  return false;
}

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
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist the file blob locally in Dexie and return a stable fileId.
 * Reports synthetic progress so existing UI (UploadOverlay) stays happy.
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
    const ok = await rtcRequestBlob(fileId).catch(() => false);
    inFlight.delete(fileId);
    if (!ok) throw new Error(`Blob ${fileId} not available locally or via peer`);
    const fetched = await getBlob(fileId);
    if (!fetched) throw new Error(`Blob ${fileId} not in Dexie after peer fetch`);
    const url = URL.createObjectURL(fetched.data);
    blobUrlCache.set(fileId, url);
    return url;
  })();

  inFlight.set(fileId, task);
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
    (media as any).url = url;
  } catch (e) {
    console.warn("[trivo] ensureMediaUrl failed", e);
  }
  return media;
}
