/** Chat previews are not consent to share our profile with a peer. */
export type ContactMembershipOrigin = "explicit" | "chat-summary";
export function mayCreateContact(
  origin: ContactMembershipOrigin, hasCurrentContact: boolean,
): boolean {
  if (origin !== "explicit" && origin !== "chat-summary")
    throw new Error("Invalid contact membership origin");
  return hasCurrentContact || origin === "explicit";
}
