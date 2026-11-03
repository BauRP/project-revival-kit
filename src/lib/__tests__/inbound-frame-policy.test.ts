import { describe, expect, it } from "vitest";
import { validateDispatchBody, boundedAcknowledgements } from "../inbound-frame-policy";
describe("authenticated but untrusted Tor frame bodies", () => {
  it("only admits bounded dispatch objects", () => {
    expect(validateDispatchBody({ id:"msg",type:"text_message" })).not.toBeNull();
    expect(validateDispatchBody([])).toBeNull();
    expect(validateDispatchBody("signed attacker data")).toBeNull();
    expect(validateDispatchBody({id:"",type:"text_message"})).toBeNull();
    expect(validateDispatchBody({id:"x".repeat(129),type:"text_message"})).toBeNull();
  });
  it("limits acknowledgement batch and individual identifiers before database lookups", () => {
    expect(boundedAcknowledgements(["one","two"])).toEqual(["one","two"]);
    expect(boundedAcknowledgements(["good",null,"x".repeat(129)])).toEqual(["good"]);
    expect(boundedAcknowledgements(Array(33).fill("id"))).toEqual([]);
    expect(boundedAcknowledgements({ ids: ["x"] })).toEqual([]);
  });
});
