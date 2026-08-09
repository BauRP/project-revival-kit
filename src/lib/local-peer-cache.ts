// Local Gun-compatible shim used by legacy call sites.
// It keeps the public API stable while avoiding centralized realtime SDKs.

type GunCallback = (data: any, key: string) => void;

type GunNode = {
  get: (key: string) => GunNode;
  put: (value: any) => GunNode;
  once: (cb: (data: any, key?: string) => void) => GunNode;
  on: (cb: GunCallback) => GunNode;
  map: () => GunNode;
  off: () => GunNode;
};

const seenMessageUUIDs = new Set<string>();
const MAX_SEEN_UUIDS = 10000;
const LOCAL_GUN_PREFIX = "trivo:local-gun:";
const KEYS_PREFIX = "trivo:keys:";
const listeners = new Map<string, Set<GunCallback>>();
// NOTE: both the client id and the BroadcastChannel are created lazily.
// Module-scope randomness / channel construction is a "disallowed operation in
// global scope" on the Cloudflare Worker that serves the preview, which makes
// every request return an opaque 500 the moment this module enters an SSR
// chunk. Lazy initialisation keeps the exact same runtime behaviour in the
// browser and the Android WebView while staying SSR-safe.
let clientIdCache: string | null = null;
function getClientId(): string {
  if (clientIdCache) return clientIdCache;
  clientIdCache = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return clientIdCache;
}

let broadcastInit = false;
let broadcastChannel: BroadcastChannel | null = null;
function getBroadcast(): BroadcastChannel | null {
  if (broadcastInit) return broadcastChannel;
  broadcastInit = true;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    broadcastChannel = null;
    return null;
  }
  try {
    broadcastChannel = new BroadcastChannel("trivo-local-gun");
    broadcastChannel.onmessage = (
      event: MessageEvent<{ origin?: string; channelId?: string; key?: string; data?: any }>,
    ) => {
      const payload = event.data;
      if (!payload || payload.origin === getClientId() || !payload.channelId || !payload.key) return;
      emit(payload.channelId, payload.data, payload.key);
    };
  } catch {
    broadcastChannel = null;
  }
  return broadcastChannel;
}

export function isUUIDv4(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function isDuplicateMessage(uuid: string): boolean {
  if (!uuid) return false;
  if (seenMessageUUIDs.has(uuid)) return true;
  seenMessageUUIDs.add(uuid);
  if (seenMessageUUIDs.size > MAX_SEEN_UUIDS) {
    const first = seenMessageUUIDs.values().next().value;
    if (first) seenMessageUUIDs.delete(first);
  }
  return false;
}

export function generateUUIDv4(): string {
  return (
    crypto.randomUUID?.() ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = (Math.random() * 16) | 0;
      return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
    })
  );
}

function storageKey(channelId: string): string {
  return `${LOCAL_GUN_PREFIX}${channelId}`;
}

function readEntries(channelId: string): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(channelId)) || "{}") || {};
  } catch {
    return {};
  }
}

function writeEntry(channelId: string, key: string, data: any): void {
  try {
    const entries = readEntries(channelId);
    entries[key] = data;
    localStorage.setItem(storageKey(channelId), JSON.stringify(entries));
  } catch {
    // Local persistence is best effort in restricted WebViews.
  }
}

function emit(channelId: string, data: any, key: string): void {
  listeners.get(channelId)?.forEach((callback) => {
    try {
      callback(data, key);
    } catch {
      // Listener failures must not break the app shell.
    }
  });
}

export function publishPublicKeys(userId: string, signingPubKey: string, exchangePubKey: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      KEYS_PREFIX + userId,
      JSON.stringify({ signingKey: signingPubKey, exchangeKey: exchangePubKey, updatedAt: Date.now() }),
    );
  } catch {
    // Non-fatal: WebRTC can still use keys stored in Dexie contacts.
  }
}

export async function lookupPublicKeys(userId: string): Promise<{ signingKey: string; exchangeKey: string } | null> {
  try {
    const cached = localStorage.getItem(KEYS_PREFIX + userId);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed?.signingKey && parsed?.exchangeKey) {
      return { signingKey: parsed.signingKey, exchangeKey: parsed.exchangeKey };
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

export function sendGunMessage(channelId: string, messagePayload: Record<string, unknown>): void {
  const key = String(messagePayload.id || generateUUIDv4());
  const data = { ...messagePayload, id: key, timestamp: Number(messagePayload.timestamp || Date.now()) };
  writeEntry(channelId, key, data);
  emit(channelId, data, key);
  try {
    getBroadcast()?.postMessage({ origin: getClientId(), channelId, key, data });
  } catch {
    // BroadcastChannel is optional.
  }
}

export function subscribeToChannel(channelId: string, callback: GunCallback): () => void {
  const set = listeners.get(channelId) || new Set<GunCallback>();
  set.add(callback);
  listeners.set(channelId, set);

  const entries = readEntries(channelId);
  Object.entries(entries).forEach(([key, data]) => callback(data, key));

  return () => {
    set.delete(callback);
    if (set.size === 0) listeners.delete(channelId);
  };
}

export function sendNoisePacket(): void {
  // Intentionally local no-op: cover traffic must not require centralized networking.
}

function makeNode(path: string[], mapped = false): GunNode {
  let unsubscribe: (() => void) | null = null;
  const node: GunNode = {
    get: (key: string) => makeNode([...path, String(key)], mapped),
    put: (value: any) => {
      const channelId = path.slice(0, -1).join("/") || path[0] || "root";
      const key = path[path.length - 1] || generateUUIDv4();
      const data = typeof value === "object" && value ? { ...value, id: key } : { value, id: key };
      sendGunMessage(channelId, data);
      return node;
    },
    once: (cb) => {
      const channelId = mapped ? path.join("/") : path.slice(0, -1).join("/") || path[0] || "root";
      const key = mapped ? undefined : path[path.length - 1];
      const entries = readEntries(channelId);
      if (mapped) {
        Object.entries(entries).forEach(([entryKey, data]) => cb(data, entryKey));
      } else {
        cb(key ? entries[key] ?? null : null, key);
      }
      return node;
    },
    on: (cb) => {
      const channelId = mapped ? path.join("/") : path.slice(0, -1).join("/") || path[0] || "root";
      const key = mapped ? undefined : path[path.length - 1];
      unsubscribe = subscribeToChannel(channelId, (data, entryKey) => {
        if (!key || entryKey === key) cb(data, entryKey);
      });
      return node;
    },
    map: () => makeNode(path, true),
    off: () => {
      unsubscribe?.();
      unsubscribe = null;
      return node;
    },
  };
  return node;
}

const gun = {
  get: (key: string) => makeNode([String(key)]),
  opt: (_opts: any) => gun,
  back: (_key: string) => ({}),
  _: { opt: { peers: {} } },
};

export default gun;