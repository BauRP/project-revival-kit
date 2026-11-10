import { describe, expect, it, vi } from "vitest";
import { contactSubscriptionKey, subscribeContactIds } from "../contact-subscriptions";

describe("contact profile and presence subscription lifecycle", () => {
  it("changes subscription identity when a contact is replaced at the same count", () => {
    expect(contactSubscriptionKey(["alice", "bob"])).not.toBe(
      contactSubscriptionKey(["alice", "carol"]));
    expect(contactSubscriptionKey(["bob", "alice"])).toBe(
      contactSubscriptionKey(["alice", "bob"]));
  });
  it("registers both channels and removes each exactly once", () => {
    const releases: string[] = [];
    const presence = vi.fn((id: string) => () => { releases.push("presence:" + id); });
    const profile = vi.fn((id: string) => () => { releases.push("profile:" + id); });
    const stop = subscribeContactIds(["alice", "bob", "alice"], presence, profile);
    expect(presence).toHaveBeenCalledTimes(2);
    expect(profile).toHaveBeenCalledTimes(2);
    stop();
    expect(releases).toHaveLength(4);
    expect(new Set(releases).size).toBe(4);
  });
  it("releases partial listeners when subscription setup fails", () => {
    const release = vi.fn();
    expect(() => subscribeContactIds(["one"], () => release, () => {
      throw new Error("profile subscribe failed");
    })).toThrow("profile subscribe failed");
    expect(release).toHaveBeenCalledOnce();
  });
});
