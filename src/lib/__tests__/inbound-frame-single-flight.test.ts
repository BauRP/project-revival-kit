import { describe, expect, it } from "vitest";
import { InboundFrameSingleFlight } from "../inbound-frame-single-flight";

describe("durable Tor incoming frames are single-flight", () => {
  it("coalesces live delivery and replay so one frame is committed only once", async () => {
    const flights = new InboundFrameSingleFlight();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let commits = 0;
    const live = flights.run("signed-frame-a", async () => { await gate; commits++; });
    const replay = flights.run("signed-frame-a", async () => { commits++; });
    expect(replay).toBe(live);
    release();
    await Promise.all([live, replay]);
    expect(commits).toBe(1);
    await flights.run("signed-frame-a", async () => { commits++; });
    // Replays after settlement still run the idempotent DB path, preserving ACK.
    expect(commits).toBe(2);
  });
  it("separately commits independent Tor senders without a global lock", async () => {
    const flights = new InboundFrameSingleFlight();
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    const done: string[] = [];
    const blocked = flights.run("a", async () => { await gate; done.push("a"); });
    await flights.run("b", async () => { done.push("b"); });
    expect(done).toEqual(["b"]);
    resolve();
    await blocked;
    expect(done).toEqual(["b", "a"]);
  });
  it("retries a failed disk transaction instead of caching a failed promise", async () => {
    const flights = new InboundFrameSingleFlight();
    let commits = 0;
    const bad = flights.run("a", async () => {
      commits++;
      throw new Error("simulated IndexedDB crash");
    });
    expect(flights.run("a", async () => { commits += 100; })).toBe(bad);
    await expect(bad).rejects.toThrow("simulated IndexedDB crash");
    await flights.run("a", async () => { commits++; });
    expect(commits).toBe(2);
  });
});
