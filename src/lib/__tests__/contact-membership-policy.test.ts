import { describe, expect, it } from "vitest";
import { mayCreateContact } from "../contact-membership-policy";
describe("private friend membership", () => {
  it("never enrolls an unknown message sender into profile sharing", () => {
    expect(mayCreateContact("chat-summary", false)).toBe(false);
  });
  it("can refresh an existing profile-sharing contact", () => {
    expect(mayCreateContact("chat-summary", true)).toBe(true);
  });
  it("permits only explicit user add or accept to create contact", () => {
    expect(mayCreateContact("explicit", false)).toBe(true);
    expect(mayCreateContact("explicit", true)).toBe(true);
  });
  it("does not allow unrecognized call sites to grant membership", () => {
    expect(() => mayCreateContact("backup" as never, false)).toThrow();
  });
});
