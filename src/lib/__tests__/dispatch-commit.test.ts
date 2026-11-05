import { describe, expect, it } from "vitest";
import { isValidDispatchId, shouldAckDispatch, shouldNotifyDispatch, sameOutgoingDispatchRoute } from "../dispatch-commit";
describe("durable Tor dispatch acknowledgement", () => {
  it("only ACKs accepted or already committed events", () => {
    expect(shouldAckDispatch("committed")).toBe(true);
    expect(shouldAckDispatch("duplicate")).toBe(true);
    expect(shouldAckDispatch("rejected")).toBe(false);
  });
  it("notifies the UI exactly once", () => {
    expect(shouldNotifyDispatch("committed")).toBe(true);
    expect(shouldNotifyDispatch("duplicate")).toBe(false);
    expect(shouldNotifyDispatch("rejected")).toBe(false);
  });
  it("rejects missing, oversized or control-character identifiers", () => {
    expect(isValidDispatchId("a-valid-message")).toBe(true);
    expect(isValidDispatchId("")).toBe(false);
    expect(isValidDispatchId("a".repeat(129))).toBe(false);
    expect(isValidDispatchId("newline\n")).toBe(false);
  });
});
describe("single-flight outgoing Tor routing", () => {
  it("coalesces only dispatches addressed to the same peer and event type", () => {
    const expected={peer:"sender.onion",kind:"text_message"};
    expect(sameOutgoingDispatchRoute(expected,expected)).toBe(true);
    expect(sameOutgoingDispatchRoute(expected,{...expected,peer:"other.onion"})).toBe(false);
    expect(sameOutgoingDispatchRoute(expected,{...expected,kind:"message_lifecycle"})).toBe(false);
  });
});
