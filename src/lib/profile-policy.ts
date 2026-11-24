import { isSafeProfileAvatar, safeProfileDisplayName, safeProfileCustomStatus } from "./profile-wire";

/** Validate locally edited profile fields before persisting or sharing them. */
export interface EditableProfileFields {
  name: string;
  avatar: string | null;
  status: "online" | "away" | "dnd" | "offline" | "custom";
  customStatus: string;
}
const STATUS = new Set(["online", "away", "dnd", "offline", "custom"]);
const LOCAL_AVATAR_MAX = 65_536;
export function validateEditableProfile(profile: EditableProfileFields): void {
  if (!safeProfileDisplayName(profile.name))
    throw new Error("Profile display name is unsafe or too long");
  if (!safeProfileCustomStatus(profile.customStatus))
    throw new Error("Profile status text is invalid or too long");
  if (!STATUS.has(profile.status))
    throw new Error("Unsupported profile status");
  if (profile.avatar !== null &&
      (typeof profile.avatar !== "string" ||
       profile.avatar.length > LOCAL_AVATAR_MAX ||
       !isSafeProfileAvatar(profile.avatar)))
    throw new Error("Unsupported profile avatar encoding");
}
export function nextProfileTimestamp(previous: number, now: number): number {
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(previous) || previous < 0)
    throw new Error("Invalid profile timestamp");
  if (previous === Number.MAX_SAFE_INTEGER)
    throw new Error("Profile timestamp overflow");
  return Math.max(previous + 1, now);
}
