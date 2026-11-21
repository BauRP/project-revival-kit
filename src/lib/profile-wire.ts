import { isValidOnion } from "./onion-id";

/** Allowlisted profile information shared only with known Tor contacts. */
export type SharedProfileStatus = "online" | "away" | "dnd" | "offline" | "custom";
export interface SharedProfile {
  userId: string;
  name: string;
  avatar: string | null;
  status: SharedProfileStatus;
  customStatus: string;
  updatedAt: number;
}

function isSafeAvatar(avatar: unknown): avatar is string | null {
  if (avatar === null) return true;
  if (typeof avatar !== "string" || avatar.length > 65_536) return false;
  const parsed = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(avatar);
  if (!parsed) return false;
  const encoded = parsed[2];
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!padding) return true;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const last = alphabet.indexOf(encoded[encoded.length - padding - 1]);
  return last >= 0 && (padding === 2 ? (last & 15) === 0 : (last & 3) === 0);
}

/** Do not send private profile data to URL aliases or uppercase contact keys. */
export function canPublishProfileToPeer(peer: string): boolean {
  return typeof peer === "string" && /^[a-z2-7]{56}\.onion$/.test(peer) &&
    isValidOnion(peer);
}

/** Signed sender, not a field controlled by remote JSON, establishes identity. */
export function validateSharedProfile(raw: unknown, authenticatedSender: string, now = Date.now()): SharedProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.userId !== authenticatedSender ||
      typeof p.name !== "string" || p.name.length > 80 ||
      typeof p.customStatus !== "string" || p.customStatus.length > 280 ||
      typeof p.status !== "string" ||
      !["online", "away", "dnd", "offline", "custom"].includes(p.status) ||
      !isSafeAvatar(p.avatar) ||
      typeof p.updatedAt !== "number" || !Number.isSafeInteger(p.updatedAt) ||
      p.updatedAt < 1 || p.updatedAt > now + 600_000) return null;
  return {
    userId: authenticatedSender,
    name: p.name,
    avatar: p.avatar,
    status: p.status as SharedProfileStatus,
    customStatus: p.customStatus,
    updatedAt: p.updatedAt,
  };
}

export function makeSharedProfile(profile: SharedProfile): SharedProfile {
  // Do not forward HTTP(S) avatar URLs or unbounded camera images to peers.
  const shared: SharedProfile = {
    userId: profile.userId,
    name: profile.name,
    avatar: isSafeAvatar(profile.avatar) ? profile.avatar : null,
    status: profile.status,
    customStatus: profile.customStatus,
    updatedAt: profile.updatedAt,
  };
  // A legacy local profile may be corrupt even when no edit is performed.
  // Fail before it can be sealed into a durable Tor profile_update.
  if (!validateSharedProfile(shared, shared.userId))
    throw new Error("Invalid local profile cannot be synchronized");
  return shared;
}
