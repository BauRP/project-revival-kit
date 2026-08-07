// User profile store (avatar, display name, presence status, custom status).
//
// Storage model:
//  - The local user's profile is persisted in IndexedDB ("settings" store) so it
//    survives component unmount/remount and full app restarts.
//  - Every profile mutation is published on the peer channel keyed by User ID,
//    so mutual contacts receive avatar / custom-status updates for that exact ID.
//  - Remote profiles are cached in memory and mirrored into the contacts meta
//    (ChatMeta.friendAvatar) so every list view renders the latest avatar.

import gun from "./gun-setup";
import { dbGet, dbPut } from "./storage";
import { getChatMeta, saveChatMeta } from "./p2p";

export type ProfileStatus = "online" | "away" | "dnd" | "offline" | "custom";

export interface UserProfile {
  userId: string;
  name: string;
  avatar: string | null;
  status: ProfileStatus;
  customStatus: string;
  updatedAt: number;
}

const LOCAL_KEY = "my-profile-v1";
const CHANNEL = "trivo-profiles";

const remoteCache = new Map<string, UserProfile>();
const remoteListeners = new Set<(profile: UserProfile) => void>();
const localListeners = new Set<(profile: UserProfile) => void>();
const subscriptions = new Map<string, { count: number; stop: () => void }>();

let localProfile: UserProfile | null = null;
let localLoaded = false;

function emptyProfile(userId: string): UserProfile {
  return {
    userId,
    name: "",
    avatar: null,
    status: "online",
    customStatus: "",
    updatedAt: 0,
  };
}

function normalize(raw: unknown, fallbackId: string): UserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const userId = typeof data.userId === "string" && data.userId ? data.userId : fallbackId;
  if (!userId) return null;
  return {
    userId,
    name: typeof data.name === "string" ? data.name : "",
    avatar: typeof data.avatar === "string" && data.avatar ? data.avatar : null,
    status: (["online", "away", "dnd", "offline", "custom"] as const).includes(
      data.status as ProfileStatus,
    )
      ? (data.status as ProfileStatus)
      : "online",
    customStatus: typeof data.customStatus === "string" ? data.customStatus : "",
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

/** Loads the local user's persisted profile (creates an empty one on first run). */
export async function loadMyProfile(userId: string): Promise<UserProfile> {
  if (localLoaded && localProfile && localProfile.userId === userId) return localProfile;
  const stored = await dbGet<UserProfile>("settings", LOCAL_KEY);
  const normalized = normalize(stored, userId);
  localProfile = normalized ? { ...normalized, userId: userId || normalized.userId } : emptyProfile(userId);
  localLoaded = true;
  return localProfile;
}

/** Returns the in-memory copy of the local profile without touching IndexedDB. */
export function getMyProfileSync(): UserProfile | null {
  return localProfile;
}

/**
 * Persists a partial profile update, then broadcasts the full profile on the
 * channel keyed by this User ID so every mutual contact re-renders it.
 */
export async function saveMyProfile(
  userId: string,
  patch: Partial<Omit<UserProfile, "userId" | "updatedAt">>,
): Promise<UserProfile> {
  const current = await loadMyProfile(userId);
  const next: UserProfile = {
    ...current,
    ...patch,
    userId: userId || current.userId,
    updatedAt: Date.now(),
  };
  localProfile = next;
  await dbPut("settings", LOCAL_KEY, next);
  publishProfile(next);
  localListeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      /* listener errors must not break saving */
    }
  });
  return next;
}

function publishProfile(profile: UserProfile): void {
  if (!profile.userId) return;
  try {
    gun.get(CHANNEL).get(profile.userId).put({
      userId: profile.userId,
      name: profile.name,
      avatar: profile.avatar,
      status: profile.status,
      customStatus: profile.customStatus,
      updatedAt: profile.updatedAt,
    });
  } catch {
    /* broadcasting is best effort; the local copy is already persisted */
  }
}

/** Re-publishes the current profile (used on transport reconnect / app start). */
export async function republishMyProfile(userId: string): Promise<void> {
  const profile = await loadMyProfile(userId);
  if (profile.updatedAt > 0) publishProfile(profile);
}

export function onMyProfileChange(cb: (profile: UserProfile) => void): () => void {
  localListeners.add(cb);
  return () => {
    localListeners.delete(cb);
  };
}

/** Cached remote profile for a User ID, if one has been received. */
export function getProfile(userId: string): UserProfile | null {
  return remoteCache.get(userId) || null;
}

export function onProfileChange(cb: (profile: UserProfile) => void): () => void {
  remoteListeners.add(cb);
  return () => {
    remoteListeners.delete(cb);
  };
}

async function handleIncoming(userId: string, raw: unknown): Promise<void> {
  const profile = normalize(raw, userId);
  if (!profile || profile.userId !== userId) return;
  const prev = remoteCache.get(userId);
  if (prev && prev.updatedAt >= profile.updatedAt) return;
  remoteCache.set(userId, profile);

  // Mirror the avatar/name into the contact record so every chat surface
  // (chat list, chat header, friends list) renders the newest version.
  try {
    const meta = await getChatMeta(userId);
    if (meta && (meta.friendAvatar !== profile.avatar || (profile.name && meta.friendName !== profile.name))) {
      await saveChatMeta({
        ...meta,
        friendAvatar: profile.avatar,
        friendName: profile.name || meta.friendName,
      });
    }
  } catch {
    /* contact mirroring is best effort */
  }

  remoteListeners.forEach((cb) => {
    try {
      cb(profile);
    } catch {
      /* ignore listener failures */
    }
  });
}

/** Subscribes to a specific User ID's profile stream. Ref-counted. */
export function subscribeToProfile(userId: string): () => void {
  if (!userId) return () => {};
  const existing = subscriptions.get(userId);
  if (existing) {
    existing.count += 1;
    return () => releaseProfile(userId);
  }

  let node: ReturnType<typeof gun.get> | null = null;
  try {
    node = gun.get(CHANNEL).get(userId);
    // Hydrate from whatever is already cached locally, then stream updates.
    node.once((data: unknown) => {
      void handleIncoming(userId, data);
    });
    node.on((data: unknown) => {
      void handleIncoming(userId, data);
    });
  } catch {
    node = null;
  }

  subscriptions.set(userId, {
    count: 1,
    stop: () => {
      try {
        node?.off();
      } catch {
        /* ignore */
      }
    },
  });

  return () => releaseProfile(userId);
}

function releaseProfile(userId: string): void {
  const entry = subscriptions.get(userId);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) {
    entry.stop();
    subscriptions.delete(userId);
  }
}
