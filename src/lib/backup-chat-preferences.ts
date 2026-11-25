/**
 * Portable per-chat privacy settings INSIDE the already password-encrypted
 * TRIVO-BACKUP-V2 payload. Keystore-bound ciphertext is never copied to a
 * different device. Older V1/V2/V3 backups without this field still restore.
 */
import {
  getChatPreferences, updateChatPreferences, validateChatPreferenceState,
  type ChatPreferenceState,
} from "./chat-preferences";
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
export function mergePortableChatPreferenceState(
  previous: ChatPreferenceState, incoming: ChatPreferenceState,
): ChatPreferenceState {
  const current = normalizedState(previous);
  const restored = normalizedState(incoming);
  return {
    ...restored, ...current,
    blocked: current.blocked === true || restored.blocked === true,
    oneTimeDefault: current.oneTimeDefault === true || restored.oneTimeDefault === true,
  };
}

export async function restorePortableChatPreferences(
  items: unknown,
): Promise<number> {
  const rows = validatePortableChatPreferences(items);
  for (const { chatId, state } of rows) {
    // updateChatPreferences on Android commits via encrypted CAS under this
    // device's Keystore; never store archive plaintext as a settings value.
    const current = await getChatPreferences(chatId);
    const merged = mergePortableChatPreferenceState(current, state);
    await updateChatPreferences(chatId, merged);
  }
  return rows.length;
}
