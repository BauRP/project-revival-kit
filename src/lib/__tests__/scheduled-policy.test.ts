import { describe, expect, it } from "vitest";
import { nextScheduledRetry, scheduledWakeAt, validateScheduledItem, validateStoredScheduledItem, type ScheduledRetryState, sameScheduledIdentity, sameScheduledState } from "../scheduled-policy";
describe("durable scheduled message identity", () => {
  const original: ScheduledRetryState & {id:string;text:string}={id:"msg",text:"hi",scheduledAt:1000,attempts:0};
  it("never rewrites scheduledAt when Tor is unavailable",()=>{
    const first=nextScheduledRetry(original,2000);
    expect(first.scheduledAt).toBe(1000);
    expect(first.nextAttemptAt).toBe(32000);
    const second=nextScheduledRetry(first,32000);
    expect(second.scheduledAt).toBe(1000);
    expect(second.nextAttemptAt).toBe(92000);
    expect(scheduledWakeAt(second)).toBe(92000);
  });
  it("accepts legacy scheduled items without retry fields",()=>{
    expect(scheduledWakeAt(original)).toBe(1000);
  });
  it("caps retry delay at one hour",()=>{
    const recent=nextScheduledRetry({...original,attempts:800},5000);
    expect(recent.nextAttemptAt).toBe(3605000);
  });
});
describe("scheduled cancellation and retry identity", () => {
  const item = {id:"id",chatId:"peer",text:"hello",createdAt:5,scheduledAt:100};
  it("cannot retry a deleted schedule or a newer schedule using its old ID",()=>{
    expect(sameScheduledIdentity(item,undefined)).toBe(false);
    expect(sameScheduledIdentity(item,{...item,createdAt:6})).toBe(false);
    expect(sameScheduledIdentity(item,{...item,text:"changed"})).toBe(false);
    expect(sameScheduledIdentity(item,item)).toBe(true);
  });
});

import { canScheduleRecipient } from "../scheduled-policy";
import { onionFromPublicKey } from "../onion-id";
describe("scheduled Tor recipient validation", () => {
  it("refuses invalid addresses before saving a durable message", () => {
    for (const peer of ["", "friend", "alice.onion", "https://host", "evil/path"])
      expect(canScheduleRecipient(peer)).toBe(false);
    expect(canScheduleRecipient("TRIVO_MOCK_PEER_999")).toBe(true);
    const genuine = onionFromPublicKey(new Uint8Array(32));
    expect(canScheduleRecipient(genuine)).toBe(true);
    expect(canScheduleRecipient("https://" + genuine)).toBe(false);
    expect(canScheduleRecipient(genuine.toUpperCase())).toBe(false);
    expect(canScheduleRecipient(genuine + "/")).toBe(false);
  });
});

describe("scheduled Tor retry after system clock correction", () => {
  it("does not wait days after an old retry was created under a wrong clock", () => {
    const now = 1_800_000_000_000;
    const pending = {scheduledAt:now-10_000,
      nextAttemptAt:now+24*60*60_000,attempts:2};
    expect(scheduledWakeAt(pending,now)).toBe(now);
  });
  it("never sends a not-yet-due scheduled message early", () => {
    const now = 1_800_000_000_000;
    const pending = {scheduledAt:now+2*24*60*60_000,
      nextAttemptAt:now+3*24*60*60_000,attempts:1};
    expect(scheduledWakeAt(pending,now)).toBe(pending.scheduledAt);
  });
  it("keeps ordinary bounded backoff and immutable scheduledAt", () => {
    const now = 1_800_000_000_000;
    const pending={scheduledAt:now-1000,nextAttemptAt:now+30_000,attempts:1};
    expect(scheduledWakeAt(pending,now)).toBe(now+30_000);
    expect(pending.scheduledAt).toBe(now-1000);
  });
});


describe("persisted scheduled ciphertext and retry validation", () => {
  const original = {
    id: "s-1", chatId: "peer", text: "plain", silent: false,
    scheduledAt: 1000, createdAt: 500, attempts: 0,
  };
  it("accepts large ciphertext without relaxing the outgoing plaintext ceiling", () => {
    const sealed = { ...original, text: "TRIVO-SCHEDULED-V1:" + "A".repeat(270_000) };
    expect(() => validateStoredScheduledItem(sealed, true)).not.toThrow();
    expect(() => validateScheduledItem(sealed)).toThrow();
    expect(() => validateStoredScheduledItem({...sealed,text:"A".repeat(512_001)},true)).toThrow();
  });
  it("refuses corrupt retry metadata before an async delivery", () => {
    for (const wrong of [
      {...original,attempts:-1}, {...original,attempts:NaN},
      {...original,nextAttemptAt:-5}, {...original,createdAt:0},
      {...original,text:""},
    ]) expect(() => validateStoredScheduledItem(wrong, false)).toThrow();
  });
});

describe("scheduled IndexedDB compare-and-write safety", () => {
  const old = {
    id: "schedule-1", chatId: "TRIVO_MOCK_PEER_999",
    text: "keystore-ciphertext", silent: false, scheduledAt: 1000,
    createdAt: 900, attempts: 1, nextAttemptAt: 32000,
  };
  it("rejects a cancelled or replaced schedule before a late delete", () => {
    expect(sameScheduledState(old, undefined)).toBe(false);
    expect(sameScheduledState(old, { ...old, createdAt: 901 })).toBe(false);
    expect(sameScheduledState(old, { ...old, text: "new protected content" })).toBe(false);
    expect(sameScheduledState(old, { ...old, silent: true })).toBe(false);
  });
  it("rejects concurrent retry changes before late retry or legacy encryption", () => {
    expect(sameScheduledState(old, old)).toBe(true);
    expect(sameScheduledState(old, { ...old, attempts: 2 })).toBe(false);
    expect(sameScheduledState(old, { ...old, nextAttemptAt: 65000 })).toBe(false);
    expect(sameScheduledState(old, { ...old, nextAttemptAt: undefined })).toBe(false);
  });
  it("supports unchanged legacy items without retry metadata", () => {
    const legacy = { ...old, attempts: undefined, nextAttemptAt: undefined };
    expect(sameScheduledState(legacy, { ...legacy })).toBe(true);
    expect(sameScheduledState(legacy, { ...legacy, attempts: 0 })).toBe(false);
  });
});
