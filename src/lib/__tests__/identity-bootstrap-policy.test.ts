import { describe, expect, it } from "vitest";
import { assertCanGenerateNewIdentity, type IdentityBootstrapCounts } from "../identity-bootstrap-policy";
const fresh = (): IdentityBootstrapCounts => ({
  contacts:0,messages:0,outbox:0,inbound:0,lifecycle:0,blobs:0,
  chunks:0,legacyContacts:0,legacyMessages:0,scheduledMessages:0,nativeFrames:0,
});
describe("identity bootstrap fail-closed policy", () => {
  it("permits true first install after checking every durable store", () => {
    expect(() => assertCanGenerateNewIdentity(fresh())).not.toThrow();
  });
  it("never regenerates a user identity over unread, queued or old contacts", () => {
    for (const key of Object.keys(fresh()) as Array<keyof IdentityBootstrapCounts>)
      expect(() => assertCanGenerateNewIdentity({...fresh(),[key]:1})).toThrow(/NOT generated/);
  });
  it("treats storage failures and unknown counts as nonempty", () => {
    expect(() => assertCanGenerateNewIdentity({...fresh(),messages:NaN})).toThrow();
    expect(() => assertCanGenerateNewIdentity({...fresh(),contacts:-1})).toThrow();
  });
});
