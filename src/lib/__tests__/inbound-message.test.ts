import { describe, expect, it } from "vitest";
import { validateIncomingTextMessage } from "../inbound-message";
const a = "a".repeat(56)+".onion", b = "b".repeat(56)+".onion";
const base = {id:"msg-1", from:a, to:b, text:"hello", timestamp:1000};
describe("untrusted inbound message boundary", () => {
  it("accepts expected fields and discards foreign fields", () => {
    expect(validateIncomingTextMessage({...base, status:"read", secretKey:"forged"},2000)).toEqual({...base,status:"delivered"});
  });
  it("rejects bogus senders, large messages and future time", () => {
    expect(validateIncomingTextMessage({...base,from:"fake"},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,text:"x".repeat(200001)},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,timestamp:999999999},2000)).toBeNull();
  });
  it("refuses attacker URLs, drops remote fields", () => {
    const media={id:"m",fileId:"f",type:"image",url:"https://evil.test/path",name:"pic",size:100,mimeType:"image/png"};
    expect(validateIncomingTextMessage({...base,media},2000)?.media?.url).toBe("");
    expect(validateIncomingTextMessage({...base,media:{...media,size:-1}},2000)).toBeNull();
  });
});