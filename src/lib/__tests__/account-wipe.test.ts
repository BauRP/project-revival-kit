import { describe, expect, it, vi } from "vitest";
import { runAccountWipe } from "../account-wipe";

describe("account deletion ordering", () => {
  const steps = (log: string[]) => ({
    stopTransport: vi.fn(async () => { log.push("stop"); }),
    deleteDatabases: vi.fn(async () => { log.push("databases"); }),
    clearNativeInbound: vi.fn(async () => { log.push("native-inbox"); }),
    eraseIdentityKeys: vi.fn(async () => { log.push("keys"); }),
  });
  it("keeps the identity until every other store has been erased", async () => {
    const log: string[] = [];
    await runAccountWipe(steps(log));
    expect(log).toEqual(["stop", "databases", "native-inbox", "keys"]);
  });
  it("retains keys when database deletion fails", async () => {
    const log: string[] = [], task = steps(log);
    task.deleteDatabases.mockImplementationOnce(async () => { throw new Error("IndexedDB blocked"); });
    await expect(runAccountWipe(task)).rejects.toThrow("IndexedDB blocked");
    expect(task.eraseIdentityKeys).not.toHaveBeenCalled();
    expect(task.clearNativeInbound).not.toHaveBeenCalled();
  });
  it("does not clear any data if Tor fails to stop", async () => {
    const log: string[] = [], task = steps(log);
    task.stopTransport.mockImplementationOnce(async () => { throw new Error("Stop failed"); });
    await expect(runAccountWipe(task)).rejects.toThrow("Stop failed");
    expect(task.deleteDatabases).not.toHaveBeenCalled();
    expect(task.eraseIdentityKeys).not.toHaveBeenCalled();
  });
  it("retains the recoverable identity if the native inbox cannot be erased", async () => {
    const log: string[] = [], task = steps(log);
    task.clearNativeInbound.mockImplementationOnce(async () => { throw new Error("Inbox locked"); });
    await expect(runAccountWipe(task)).rejects.toThrow("Inbox locked");
    expect(task.eraseIdentityKeys).not.toHaveBeenCalled();
  });
});
