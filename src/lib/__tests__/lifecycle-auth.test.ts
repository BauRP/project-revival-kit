import { describe, expect, it } from "vitest";
import { canApplyRemoteLifecycle, acceptsLifecycleTimestamp } from "../lifecycle-auth";
const from = "alice.onion", to = "bob.onion", ck = [from,to].sort().join("__");
describe("authenticated lifecycle commands", () => {
  it("allows only the original author to edit or delete for everyone", () => {
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{editedText:"hello",isEdited:true})).toBe(true);
    expect(canApplyRemoteLifecycle({from,to},to,from,ck,{editedText:"forged"})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},to,from,ck,{deletedForEveryone:true})).toBe(false);
  });
  it("rejects injected and untrusted fields", () => {
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{deletedFor:[from]})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{messageId:"other"})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{"__proto__":true})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{clearPin:true})).toBe(true);
  });
  it("rejects unknown participants and forged timestamps", () => {
    expect(canApplyRemoteLifecycle({from,to},"eve.onion",to,ck,{clearPin:true})).toBe(false);
    expect(acceptsLifecycleTimestamp(200,100,300)).toBe(false);
    expect(acceptsLifecycleTimestamp(200,200,300)).toBe(false);
    expect(acceptsLifecycleTimestamp(200,250,300)).toBe(true);
    expect(acceptsLifecycleTimestamp(200,1_000_000,300)).toBe(false);
  });
});
