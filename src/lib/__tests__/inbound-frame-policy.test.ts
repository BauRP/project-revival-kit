import { describe, expect, it } from "vitest";
import { validateDispatchBody, boundedAcknowledgements, boundedDispatchString } from "../inbound-frame-policy";
describe("authenticated but untrusted Tor frame bodies", () => {
  it("only admits bounded dispatch objects", () => {
    expect(validateDispatchBody({ id:"msg",type:"text_message" })).not.toBeNull();
    expect(validateDispatchBody([])).toBeNull();
    expect(validateDispatchBody("signed attacker data")).toBeNull();
    expect(validateDispatchBody({id:"",type:"text_message"})).toBeNull();
    expect(validateDispatchBody({id:"x".repeat(129),type:"text_message"})).toBeNull();
    expect(validateDispatchBody({id:"bad\\nID",type:"text_message"})).toBeNull();
    expect(validateDispatchBody({id:"safe",type:"bad\\nkind"})).toBeNull();
  });
  it("limits acknowledgement batch and individual identifiers before database lookups", () => {
    expect(boundedAcknowledgements(["one","two"])).toEqual(["one","two"]);
    expect(boundedAcknowledgements(["good",null,"x".repeat(129)])).toEqual(["good"]);
    expect(boundedAcknowledgements(Array(33).fill("id"))).toEqual([]);
    expect(boundedAcknowledgements({ ids: ["x"] })).toEqual([]);
    expect(boundedAcknowledgements(["one","one","two"])).toEqual(["one","two"]);
    expect(boundedAcknowledgements(["ok","bad\\nID",{},null])).toEqual(["ok"]);
  });
});

describe("untrusted signed Tor lifecycle identifiers", () => {
  it("accepts bounded literal identifiers without coercion", () => {
    expect(boundedDispatchString("message-1")).toBe("message-1");
    expect(boundedDispatchString("a".repeat(256), 256)).toBe("a".repeat(256));
  });
  it("rejects pathological or forged JSON values before IndexedDB access", () => {
    for (const value of [null, undefined, false, 0, [], {},
      {toString:"malicious"}, "x".repeat(129), "", "bad\nkey"]) {
      expect(boundedDispatchString(value)).toBeNull();
    }
  });
});
