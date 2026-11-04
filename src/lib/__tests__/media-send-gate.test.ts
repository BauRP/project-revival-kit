import { describe, expect, it } from "vitest";
import { MediaSendGate } from "../media-send-gate";

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("background Tor media send gate", () => {
  it("starts a large send without blocking inbound frame handling", async () => {
    let release!: () => void;
    let entered = false;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const gate = new MediaSendGate(2);
    expect(gate.start("peer", "file", async () => {
      entered = true;
      await pending;
    })).toBe(true);
    expect(entered).toBe(false);
    expect(gate.activeCount).toBe(1);
    await tick();
    expect(entered).toBe(true);
    expect(gate.start("peer", "file", async () => {})).toBe(false);
    release();
    await tick();
    expect(gate.activeCount).toBe(0);
    expect(gate.start("peer", "file", async () => {})).toBe(true);
    await tick();
  });

  it("bounds simultaneous sends across unrelated peers", async () => {
    let unblock!: () => void;
    const pending = new Promise<void>((resolve) => { unblock = resolve; });
    const gate = new MediaSendGate(1);
    expect(gate.start("alice", "one", () => pending)).toBe(true);
    expect(gate.start("bob", "two", async () => {})).toBe(false);
    unblock();
    await tick();
    expect(gate.start("bob", "two", async () => {})).toBe(true);
    await tick();
  });

  it("releases a failed transfer and allows retry without an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const gate = new MediaSendGate(1, (e) => { errors.push(e); });
    expect(gate.start("alice", "one", async () => {
      throw new Error("Tor disconnected");
    })).toBe(true);
    await tick();
    expect(errors).toHaveLength(1);
    expect(gate.activeCount).toBe(0);
    expect(gate.start("alice", "one", async () => {})).toBe(true);
    await tick();
  });
});
