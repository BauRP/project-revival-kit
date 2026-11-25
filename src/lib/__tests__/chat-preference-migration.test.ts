import { describe, expect, it, vi } from "vitest";
import {
  legacyPreferenceChatId, migrateChatPreferencePages,
} from "../chat-preference-migration";

describe("Android encrypted chat setting background migration", () => {
  it("only migrates legacy preferences, never sealed-of-sealed records", () => {
    expect(legacyPreferenceChatId("chat-preferences-alice")).toBe("alice");
    expect(legacyPreferenceChatId("chat-preferences-sealed-alice")).toBeNull();
    expect(legacyPreferenceChatId("other-alice")).toBeNull();
    expect(legacyPreferenceChatId("chat-preferences-")).toBeNull();
    expect(legacyPreferenceChatId("chat-preferences-" + "x".repeat(129))).toBeNull();
    expect(legacyPreferenceChatId("chat-preferences-bad\nkey")).toBeNull();
  });

  it("walks a large installation in bounded key pages, skipping sealed rows", async () => {
    const keys = Array.from({ length: 80 }, (_, i) =>
      "chat-preferences-" + String(i).padStart(3, "0"));
    keys.push("chat-preferences-sealed-001");
    keys.sort();
    const migrated: string[] = [];
    const scans = vi.fn(async (after?: string) => {
      const remaining = keys.filter(key => after === undefined || key > after);
      return remaining.slice(0, 32);
    });
    const pause = vi.fn(async () => undefined);
    const count = await migrateChatPreferencePages(
      () => false, scans,
      async id => { migrated.push(id); }, pause,
    );
    expect(count).toBe(80);
    expect(migrated).toHaveLength(80);
    expect(migrated.every(id => !id.startsWith("sealed-"))).toBe(true);
    expect(scans.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(pause).toHaveBeenCalled();
  });

  it("stops before the next record when account deletion is requested", async () => {
    const processed: string[] = [];
    let stopped = false;
    const count = await migrateChatPreferencePages(
      () => stopped,
      async () => ["chat-preferences-a", "chat-preferences-b"],
      async id => { processed.push(id); stopped = true; },
      async () => undefined,
    );
    expect(count).toBe(1);
    expect(processed).toEqual(["a"]);
  });

  it("does not swallow a Keystore failure or move past a corrupt record", async () => {
    const migrated = vi.fn(async (_id: string) => {
      throw new Error("Keystore key unavailable");
    });
    await expect(migrateChatPreferencePages(
      () => false,
      async () => ["chat-preferences-a", "chat-preferences-b"],
      migrated,
      async () => undefined,
    )).rejects.toThrow("Keystore key unavailable");
    expect(migrated).toHaveBeenCalledTimes(1);
  });

  it("returns without reading IndexedDB after a wipe is requested", async () => {
    const scan = vi.fn(async () => ["chat-preferences-a"]);
    const count = await migrateChatPreferencePages(() => true, scan);
    expect(count).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });
});
