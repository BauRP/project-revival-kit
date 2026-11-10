import { describe, expect, it, vi } from "vitest";
import { createBiometricStore, initialBiometricLocked } from "../biometric-state";

describe("shared fail-closed biometric lock state", () => {
  it("requires the lock before first native frame when protection is enabled", () => {
    expect(initialBiometricLocked(true, true)).toBe(true);
    expect(initialBiometricLocked(true, false)).toBe(false);
    expect(initialBiometricLocked(false, true)).toBe(false);
  });
  it("notifies two independently mounted consumers on settings changes", () => {
    const store = createBiometricStore({
      isAvailable: false, isEnabled: false, isLocked: false,
    });
    const chat = vi.fn();
    const settings = vi.fn();
    const offChat = store.subscribe(chat);
    const offSettings = store.subscribe(settings);
    store.update({ isEnabled: true });
    expect(store.getSnapshot().isEnabled).toBe(true);
    expect(chat).toHaveBeenCalledOnce();
    expect(settings).toHaveBeenCalledOnce();
    offSettings();
    store.update({ isLocked: true });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(settings).toHaveBeenCalledOnce();
    offChat();
  });
  it("does not broadcast meaningless updates, and remains locked until explicit success", () => {
    const store = createBiometricStore({
      isAvailable: true, isEnabled: true, isLocked: true,
    });
    const event = vi.fn();
    store.subscribe(event);
    const previous = store.getSnapshot();
    store.update({ isLocked: true });
    expect(store.getSnapshot()).toBe(previous);
    expect(event).not.toHaveBeenCalled();
    store.update({ isLocked: false });
    expect(event).toHaveBeenCalledOnce();
  });
});
