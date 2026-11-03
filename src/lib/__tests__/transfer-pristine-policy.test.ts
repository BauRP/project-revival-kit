import { describe, expect, it } from "vitest";
import { isBuiltInWelcomeMessage, isBuiltInSupportContact } from "../transfer-pristine-policy";
describe("fresh-device restore after the first-launch support greeting", () => {
  it("exempts only the shipped local bot greeting, not arbitrary messages", () => {
    const welcome={id:"mock-welcome-v1",from:"TRIVO_MOCK_PEER_999",to:"self",text:"Hello"};
    expect(isBuiltInWelcomeMessage(welcome)).toBe(true);
    expect(isBuiltInWelcomeMessage({...welcome,id:"reply-1"})).toBe(false);
    expect(isBuiltInWelcomeMessage({...welcome,from:"user.onion"})).toBe(false);
    expect(isBuiltInWelcomeMessage({...welcome,to:"friend.onion"})).toBe(false);
    expect(isBuiltInWelcomeMessage({...welcome,text:"x".repeat(1001)})).toBe(false);
  });
  it("exempts the default bot contact only, never another contact", () => {
    const contact={friendId:"TRIVO_MOCK_PEER_999",friendName:"Trivo Support (Bot)"};
    expect(isBuiltInSupportContact(contact)).toBe(true);
    expect(isBuiltInSupportContact({...contact,friendId:"friend"})).toBe(false);
    expect(isBuiltInSupportContact({...contact,friendName:"Custom contact"})).toBe(false);
  });
});
