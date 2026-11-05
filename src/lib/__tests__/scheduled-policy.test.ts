import { describe, expect, it } from "vitest";
import { nextScheduledRetry, scheduledWakeAt, validateScheduledItem, type ScheduledRetryState, sameScheduledIdentity } from "../scheduled-policy";
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
describe("scheduled Tor recipient validation", () => {
  it("refuses invalid addresses before saving a durable message", () => {
    for (const peer of ["", "friend", "alice.onion", "https://host", "evil/path"])
      expect(canScheduleRecipient(peer)).toBe(false);
    expect(canScheduleRecipient("TRIVO_MOCK_PEER_999")).toBe(true);
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
