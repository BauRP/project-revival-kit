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
