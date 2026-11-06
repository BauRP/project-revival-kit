import { describe, expect, it } from "vitest";
import { KeyedSerialQueue } from "../keyed-serial-queue";

describe("Tor media chunks are serialized per file", () => {
  it("prevents overlapping writes for the same file without dropping pieces", async () => {
    const queue = new KeyedSerialQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const events: string[] = [];
    const first = queue.run("same-file", async () => {
      events.push("first-start");
      signalStarted();
      await gate;
      events.push("first-end");
    });
    const second = queue.run("same-file", async () => {
      events.push("second-start");
      events.push("second-end");
    });
    // Queue scheduling takes more than one microtask. Wait for the actual
    // start signal instead of relying on a fragile fixed microtask count.
    await started;
    expect(events).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start","first-end","second-start","second-end"]);
  });
  it("does not block an independent file while another transfer is stalled", async () => {
    const queue = new KeyedSerialQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const waiting = queue.run("video", async () => gate);
    await queue.run("photo", async () => "complete");
    release();
    await waiting;
  });
  it("allows the next chunk after a failed IndexedDB transaction", async () => {
    const queue = new KeyedSerialQueue();
    const first = queue.run("broken", async () => { throw new Error("disk failure"); });
    const second = queue.run("broken", async () => "retry saved");
    await expect(first).rejects.toThrow("disk failure");
    await expect(second).resolves.toBe("retry saved");
    expect(await queue.run("broken", async () => "later")).toBe("later");
  });
});
