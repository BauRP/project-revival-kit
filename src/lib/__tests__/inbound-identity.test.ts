import { describe, expect, it } from "vitest";
import { duplicateMessageMatches } from "../inbound-identity";
const base = {id:"msg1",from:"alice.onion",to:"bob.onion",text:"hello",timestamp:1000};
describe("authenticated duplicate inbound identity",()=>{
  it("accepts byte-equivalent retries despite local delivery state",()=>{
    expect(duplicateMessageMatches({ ...base, status:"read" } as typeof base, { ...base, status:"delivered" } as typeof base)).toBe(true);
  });
  it("accepts retransmission after viewing a one-time attachment without restoring it",()=>{
    const media={id:"f",fileId:"f",name:"photo",size:3,type:"image",mimeType:"image/png"};
    expect(duplicateMessageMatches({...base, oneTimeView:true,oneTimeConsumed:true,media:undefined},
      {...base,oneTimeView:true,media})).toBe(true);
    expect(duplicateMessageMatches({...base,oneTimeView:true,oneTimeConsumed:true,media:undefined},
      {...base,oneTimeView:true,text:"changed",media})).toBe(false);
    expect(duplicateMessageMatches({...base,oneTimeView:true,oneTimeConsumed:true,media:undefined},
      {...base,oneTimeView:false,media})).toBe(false);
  });
  it("rejects conflicting senders, text, timestamp and media",()=>{
    expect(duplicateMessageMatches(base,{...base,from:"eve.onion"})).toBe(false);
    expect(duplicateMessageMatches(base,{...base,text:"tampered"})).toBe(false);
    expect(duplicateMessageMatches(base,{...base,timestamp:1001})).toBe(false);
    const media = {fileId:"f",id:"f",name:"x",size:2,mimeType:"image/png",type:"image"};
    expect(duplicateMessageMatches({...base,media},{...base,media:{...media,fileId:"other"}})).toBe(false);
  });
});
