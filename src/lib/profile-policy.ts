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
  if (typeof profile.name !== "string" || profile.name.length > 80 ||
      /[\u0000-\u001f\u007f\u202a-\u202e]/.test(profile.name))
    throw new Error("Profile display name is unsafe or too long");
  if (typeof profile.customStatus !== "string" ||
      profile.customStatus.length > 280 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(profile.customStatus))
    throw new Error("Profile status text is invalid or too long");
  if (!STATUS.has(profile.status))
    throw new Error("Unsupported profile status");
  if (profile.avatar !== null &&
      (typeof profile.avatar !== "string" ||
       profile.avatar.length > LOCAL_AVATAR_MAX ||
       !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.avatar)))
    throw new Error("Unsupported profile avatar encoding");
}
export function nextProfileTimestamp(previous: number, now: number): number {
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(previous) || previous < 0)
    throw new Error("Invalid profile timestamp");
  return Math.max(previous + 1, now);
}
