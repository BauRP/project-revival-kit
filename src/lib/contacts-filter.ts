// Phase 3 §3 — Contacts-only mode. Anti-spam filter that blocks messages
// from senders who are not in the user's contact list.

const STORAGE_KEY = "trivo-contacts-only";
const BLOCKED_KEY = "trivo-blocked-senders";
const CONTACTS_KEY = "trivo-contacts"; // existing contacts list (ids)

export function isContactsOnlyEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setContactsOnlyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent("trivo:contacts-only", { detail: enabled }));
  } catch {
    /* ignore */
  }
}

function readContacts(): Set<string> {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.map(String));
    return new Set();
  } catch {
    return new Set();
  }
}

function readBlocked(): Set<string> {
  try {
    const raw = localStorage.getItem(BLOCKED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.map(String));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeBlocked(set: Set<string>): void {
  try {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function isContact(senderId: string | null | undefined): boolean {
  if (!senderId) return false;
  return readContacts().has(String(senderId));
}

/** Returns true if this sender's message should be blocked under the current policy. */
export function shouldBlockIncoming(senderId: string | null | undefined): boolean {
  if (!isContactsOnlyEnabled()) return false;
  if (!senderId) return true;
  return !isContact(senderId);
}

export function moveToBlocked(senderId: string): void {
  const blocked = readBlocked();
  blocked.add(senderId);
  writeBlocked(blocked);
}

export function listBlocked(): string[] {
  return [...readBlocked()];
}
