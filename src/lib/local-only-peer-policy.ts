/** The bundled Trivo Support fixture is the ONLY local-only chat.
 * An invalid/non-onion recipient must never look "delivered" in the UI.
 */
export const LOCAL_SUPPORT_PEER_ID = "TRIVO_MOCK_PEER_999";
export function isLocalSupportPeer(value: string): boolean {
  return value === LOCAL_SUPPORT_PEER_ID;
}
