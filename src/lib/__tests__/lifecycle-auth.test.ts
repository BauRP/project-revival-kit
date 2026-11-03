import { describe, expect, it } from "vitest";
import { canApplyRemoteLifecycle, acceptsLifecycleTimestamp, canMutateDeletedMessage } from "../lifecycle-auth";
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

describe("lifecycle mutation invariants",()=>{
  it("requires coherent edit and pin payloads",()=>{
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{isEdited:true})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{editedText:"changed"})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{pinnedAt:123})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{pinnedAt:123,pinnedBy:from})).toBe(true);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{clearPin:true,pinnedAt:123,pinnedBy:from})).toBe(false);
    expect(canApplyRemoteLifecycle({from,to},from,to,ck,{deletedForEveryone:true,isEdited:true,editedText:"x"})).toBe(false);
  });
});


describe("permanent remote deletion", () => {
  it("refuses a later authenticated edit or pin after delete-for-everyone", () => {
    const previous = { deletedForEveryone: true, remoteUpdatedAt: 100 };
    expect(canMutateDeletedMessage(previous, { isEdited: true, editedText: "resurrect" })).toBe(false);
    expect(canMutateDeletedMessage(previous, { pinnedAt: 200, pinnedBy: from })).toBe(false);
    expect(canMutateDeletedMessage(previous, { deletedForEveryone: true })).toBe(false);
    expect(canMutateDeletedMessage({}, { isEdited: true, editedText: "before deletion" })).toBe(true);
  });
});

import { isDuplicateRemoteDeletion } from "../lifecycle-auth";
describe("durable terminal deletion ACK policy", () => {
  const erased={deletedForEveryone:true,remoteUpdatedAt:100};
  it("accepts an authenticated retransmission of terminal deletion", () => {
    expect(isDuplicateRemoteDeletion(erased,{deletedForEveryone:true})).toBe(true);
    expect(isDuplicateRemoteDeletion(erased,{deletedForEveryone:true,isEdited:false})).toBe(true);
  });
  it("never treats a post-deletion edit or pin as a valid duplicate", () => {
    expect(isDuplicateRemoteDeletion(erased,{deletedForEveryone:true,editedText:"secret"})).toBe(false);
    expect(isDuplicateRemoteDeletion(erased,{pinnedAt:100,pinnedBy:from})).toBe(false);
    expect(isDuplicateRemoteDeletion({}, {deletedForEveryone:true})).toBe(false);
  });
});

import { canAuthorModifyOwnMessage } from "../lifecycle-auth";
describe("local sender must own global mutation before queueing it", () => {
  it("allows editing and global deletion only for exact original participants", () => {
    expect(canAuthorModifyOwnMessage({from,to},from,to)).toBe(true);
    expect(canAuthorModifyOwnMessage({from,to},to,from)).toBe(false);
    expect(canAuthorModifyOwnMessage({from,to},from,"third")).toBe(false);
    expect(canAuthorModifyOwnMessage(undefined,from,to)).toBe(false);
    expect(canAuthorModifyOwnMessage({from,to},from,from)).toBe(false);
  });
});
