/**
 * A pristine install may auto-create exactly one local Trivo Support greeting.
 * Do not mistake that fixture for user data when restoring to a new phone.
 * Real conversations and modified fixture records remain protected.
 */
const SUPPORT_ID = "TRIVO_MOCK_PEER_999";

export function isBuiltInWelcomeMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const msg = value as Record<string, unknown>;
  return typeof msg.id === "string" &&
    (msg.id === "mock-welcome-v1" || /^mock-welcome-[0-9]{10,17}$/.test(msg.id)) &&
    msg.from === SUPPORT_ID && msg.to === "self" &&
    typeof msg.text === "string" && msg.text.length <= 1_000;
}

export function isBuiltInSupportContact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contact = value as Record<string, unknown>;
  return contact.friendId === SUPPORT_ID &&
    contact.friendName === "Trivo Support (Bot)";
}
