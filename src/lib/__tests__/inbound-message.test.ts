import { describe, expect, it } from "vitest";
import { validateIncomingTextMessage } from "../inbound-message";
import { onionFromPublicKey } from "../onion-id";
const a = onionFromPublicKey(new Uint8Array(32));
const b = onionFromPublicKey(new Uint8Array(32).fill(1));
const base = {id:"msg-1", from:a, to:b, text:"hello", timestamp:1000};
describe("untrusted inbound message boundary", () => {
  it("accepts expected fields and discards foreign fields", () => {
    expect(validateIncomingTextMessage({...base, status:"read", secretKey:"forged"},2000)).toEqual({...base,status:"delivered"});
  });
  it("rejects bogus senders, large messages and future time", () => {
    expect(validateIncomingTextMessage({...base,from:"fake"},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,from:"https://"+a},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,to:a.toUpperCase()},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,from:"a".repeat(56)+".onion"},2000))
      .toBeNull(); // Valid length but invalid Tor checksum
    expect(validateIncomingTextMessage({...base,text:"x".repeat(200001)},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,timestamp:999999999},2000)).toBeNull();
  });
  it("refuses attacker URLs, drops remote fields", () => {
    const media={id:"m",fileId:"f",type:"image",url:"https://evil.test/path",name:"pic",size:100,mimeType:"image/png"};
    expect(validateIncomingTextMessage({...base,media},2000)?.media?.url).toBe("");
    expect(validateIncomingTextMessage({...base,media:{...media,size:-1}},2000)).toBeNull();
  });
});
describe("hostile authenticated attachment JSON", () => {
  const media={id:"m",fileId:"file-1",type:"image",name:"photo.jpg",
    size:1024,mimeType:"image/jpeg"};
  it("rejects objects and fake coercion in remote media type", () => {
    expect(validateIncomingTextMessage({...base,media:{...media,type:{toString:"image"}}},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,media:{...media,type:["image"]}},2000)).toBeNull();
  });
  it("rejects dangerous attachment paths and malformed identifiers", () => {
    for (const name of ["../photo.jpg", "folder\\photo.jpg", "hello\nphoto.jpg", "photo\u202egpj.exe"]) {
      expect(validateIncomingTextMessage({...base,media:{...media,name}},2000)).toBeNull();
    }
    expect(validateIncomingTextMessage({...base,media:{...media,fileId:"../bad"}},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,media:{...media,id:""}},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,media:{...media,id:"bad\nmedia"}},2000)).toBeNull();
    expect(validateIncomingTextMessage({...base,id:"bad\nmessage"},2000)).toBeNull();
  });
});
