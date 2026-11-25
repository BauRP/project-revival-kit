/**
 * Portable per-chat privacy settings INSIDE the already password-encrypted
 * TRIVO-BACKUP-V2 payload. Keystore-bound ciphertext is never copied to a
 * different device. Older V1/V2/V3 backups without this field still restore.
 */
import {
  getChatPreferences, validateChatPreferenceState,
  type ChatPreferenceState, type DisappearingDuration,
} from "./chat-preferences";
import { platform } from "./platform";
import { dbUpdateStrict } from "./storage";
import { dbListKeysByPrefixStrict } from "./storage";

const PREFIX = "chat-preferences-";
const SEALED_PREFIX = "chat-preferences-sealed-";
const MAX_ROWS = 20_000;
const MAX_STATE_CHARS = 8_192;
const PAGE = 32;
const VALID_FIELDS = new Set([
  "blocked", "mutedUntil", "disappearingDuration", "silentDefault",
  "oneTimeDefault", "favorite", "archived",
]);

export interface PortableChatPreference {
  chatId: string;
  state: ChatPreferenceState;
}

/** Do not accept object keys able to spoof application internals. */
function normalizedState(value: unknown): ChatPreferenceState {
  const validated = validateChatPreferenceState(value);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid portable chat preferences");
  const plain = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(plain)) {
    if (!VALID_FIELDS.has(key))
      throw new Error("Unsupported portable chat preference field");
    if (plain[key] !== undefined) result[key] = plain[key];
  }
  const encoded = JSON.stringify(result);
  if (encoded.length > MAX_STATE_CHARS)
    throw new Error("Portable chat preferences exceed size limit");
  return validated as ChatPreferenceState;
}

export function validatePortableChatPreferences(value: unknown): PortableChatPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ROWS)
    throw new Error("Invalid portable chat preference list");
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Invalid portable chat preference");
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some(k => k !== "chatId" && k !== "state"))
      throw new Error("Unknown portable chat preference metadata");
    const id = entry.chatId;
    if (typeof id !== "string" || id.length < 1 || id.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(id) || id.startsWith("sealed-"))
      throw new Error("Invalid portable chat identity");
    if (seen.has(id)) throw new Error("Duplicate portable chat preferences");
    seen.add(id);
    return { chatId: id, state: normalizedState(entry.state) };
  });
}

/** Only keys, never the raw settings values, are scanned in bounded pages.
 * A sealed key takes precedence over its legacy companion during an
 * interrupted migration; getChatPreferences verifies the pair before export.
 */
export async function exportPortableChatPreferences(): Promise<PortableChatPreference[]> {
  const ids = new Set<string>();
  let last: string | undefined;
  while (true) {
    const keys = await dbListKeysByPrefixStrict("settings", PREFIX, last, PAGE);
    if (!keys.length) break;
    for (const key of keys) {
      const id = key.startsWith(SEALED_PREFIX)
        ? key.slice(SEALED_PREFIX.length) : key.slice(PREFIX.length);
      if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id))
        throw new Error("Cannot export invalid chat preferences");
      ids.add(id);
      if (ids.size > MAX_ROWS)
        throw new Error("Too many chat preferences to export safely");
    }
    last = keys[keys.length - 1];
    if (keys.length < PAGE) break;
  }
  const rows: PortableChatPreference[] = [];
  for (const id of ids) {
    const state = await getChatPreferences(id);
    rows.push({ chatId: id, state: normalizedState(state) });
  }
  return rows;
}

/** Keep existing privacy decisions on a device being restored onto. An old
 * archive must not silently unblock a peer or lower the one-time default.
 * Other fields from the backup fill only previously unset local settings.
 */
/** During restore the stricter disappearing interval always wins.
 * Users may explicitly relax it later, outside the restore operation.
 */
function stricterDuration(
  current?: DisappearingDuration, incoming?: DisappearingDuration,
): DisappearingDuration | undefined {
  const strength: Record<DisappearingDuration, number> = {
    "1h": 1, "6h": 6, "12h": 12, "24h": 24, off: Infinity,
  };
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  return strength[current] <= strength[incoming] ? current : incoming;
}

export function mergePortableChatPreferenceState(
  previous: ChatPreferenceState, incoming: ChatPreferenceState,
): ChatPreferenceState {
  const current = normalizedState(previous);
  const restored = normalizedState(incoming);
  const mutedUntil = current.mutedUntil === undefined ? restored.mutedUntil :
    restored.mutedUntil === undefined ? current.mutedUntil :
    Math.max(current.mutedUntil ?? 0, restored.mutedUntil ?? 0) || null;
  return {
    ...restored, ...current,
    blocked: current.blocked === true || restored.blocked === true,
    oneTimeDefault: current.oneTimeDefault === true || restored.oneTimeDefault === true,
    silentDefault: current.silentDefault === true || restored.silentDefault === true,
    disappearingDuration: stricterDuration(
      current.disappearingDuration, restored.disappearingDuration),
    mutedUntil,
  };
}

export async function restorePortableChatPreferences(
  items: unknown,
): Promise<number> {
  const rows = validatePortableChatPreferences(items);
  for (const { chatId, state } of rows) {
    // Every retry merges the incoming privacy state against the LATEST
    // committed value, not an old snapshot from another open WebView.
    if (platform() === "android") {
      const { updateProtectedChatPreferences } = await import("./protected-chat-preferences");
      await updateProtectedChatPreferences(chatId, (current) =>
        mergePortableChatPreferenceState(current, state));
    } else {
      await dbUpdateStrict("settings", PREFIX + chatId, (current) =>
        mergePortableChatPreferenceState(
          validateChatPreferenceState(current), state));
    }
  }
  return rows.length;
}
