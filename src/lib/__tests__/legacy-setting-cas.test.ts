import { describe, expect, it, vi } from "vitest";
import { ConcurrentProtectedWriteError } from "../storage";
import { retryConditionalSettingUpdate } from "../legacy-setting-cas";
import { shouldApplyIncomingFriendRequest } from "../friend-request-policy";

type RequestState = { status: "pending" | "accepted" | "declined"; timestamp: number };
const pending = (timestamp: number): RequestState => ({ status:"pending", timestamp });

describe("durable legacy friend-request state mutations", () => {
  it("retries two racing requests against the latest committed timestamp", async () => {
    let disk: RequestState | undefined = pending(200);
    let conflict = true;
    const write = vi.fn(async (expected: RequestState | undefined, next: RequestState) => {
      if (conflict) {
        conflict = false;
        disk = pending(300); // Another WebView committed while we read.
        throw new ConcurrentProtectedWriteError();
      }
      expect(expected).toEqual(pending(300));
      disk = next;
    });
    const result = await retryConditionalSettingUpdate({
      read: async () => disk,
      compareWrite: write,
    }, (current) => shouldApplyIncomingFriendRequest(current, 400) ? pending(400) : undefined);
    expect(result).toEqual({ value: pending(400), changed:true });
    expect(write).toHaveBeenCalledTimes(2);
    expect(disk).toEqual(pending(400));
  });
  it("never rolls back an accepted or declined decision on signed replays", async () => {
    for (const status of ["accepted", "declined"] as const) {
      const disk: RequestState = {status, timestamp:200};
      const write = vi.fn(async () => undefined);
      const result = await retryConditionalSettingUpdate({
        read: async () => disk, compareWrite: write,
      }, (current) => shouldApplyIncomingFriendRequest(current, 999) ? pending(999) : undefined);
      expect(result.changed).toBe(false);
      expect(result.value).toEqual(disk);
      expect(write).not.toHaveBeenCalled();
    }
  });
  it("does not fire a new UI event for duplicate or older pending requests", async () => {
    const disk = pending(500);
    const write = vi.fn(async () => undefined);
    for (const stamp of [500, 400]) {
      const result = await retryConditionalSettingUpdate({
        read: async () => disk, compareWrite: write,
      }, (current) => shouldApplyIncomingFriendRequest(current, stamp)
        ? pending(stamp) : undefined);
      expect(result.changed).toBe(false);
    }
    expect(write).not.toHaveBeenCalled();
  });
  it("does not retry disk failures or untrusted malformed-state errors", async () => {
    const write = vi.fn(async () => { throw new Error("quota exceeded"); });
    await expect(retryConditionalSettingUpdate({
      read: async () => pending(1), compareWrite: write,
    }, () => pending(2))).rejects.toThrow("quota exceeded");
    expect(write).toHaveBeenCalledOnce();
  });
  it("refuses success after repeated cross-WebView conflicts", async () => {
    const write = vi.fn(async () => { throw new ConcurrentProtectedWriteError(); });
    await expect(retryConditionalSettingUpdate({
      read: async () => undefined, compareWrite: write,
    }, () => pending(1))).rejects.toThrow("changed in another session");
    expect(write).toHaveBeenCalledTimes(6);
  });
  it("serializes accepting a request without creating a new pending request", async () => {
    let disk = pending(100);
    const result = await retryConditionalSettingUpdate({
      read: async () => disk,
      compareWrite: async (previous, next) => {
        expect(previous).toEqual(pending(100));
        disk = next;
      },
    }, (previous) => previous?.status === "pending"
      ? {...previous, status:"accepted" as const} : undefined);
    expect(result.changed).toBe(true);
    expect(disk).toEqual({status:"accepted", timestamp:100});
  });
});
