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
  return avatar === null ||
    (typeof avatar === "string" && avatar.length <= 65_536 &&
      /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar));
}

/** Signed sender, not a field controlled by remote JSON, establishes identity. */
export function validateSharedProfile(raw: unknown, authenticatedSender: string, now = Date.now()): SharedProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.userId !== authenticatedSender ||
      typeof p.name !== "string" || p.name.length > 80 ||
      typeof p.customStatus !== "string" || p.customStatus.length > 280 ||
      !["online", "away", "dnd", "offline", "custom"].includes(String(p.status)) ||
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
  return { ...profile, avatar: isSafeAvatar(profile.avatar) ? profile.avatar : null };
}
