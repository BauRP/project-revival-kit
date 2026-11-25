import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { checkPermissions: vi.fn(), schedule: vi.fn() },
}));
vi.mock("@capacitor-mlkit/translation", () => ({
  Translation: { translate: vi.fn() },
}));
vi.mock("@/lib/translation-config", () => ({
  detectLanguage: vi.fn(), getTranslationSettings: vi.fn(),
  translateWithBundledDictionary: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({ isNative: () => false }));
vi.mock("@/lib/safe-storage", () => ({ isStorageAvailable: () => true }));

import { notifyIncomingMessage } from "../notifications";

afterEach(() => vi.unstubAllGlobals());

describe("browser notification failures must not break incoming messages", () => {
  it("ignores a browser notification constructor error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", { Notification: true });
    class FailingNotification {
      static permission = "granted";
      constructor() { throw new Error("Browser notification blocked"); }
    }
    vi.stubGlobal("Notification", FailingNotification);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "trivo-hide-content" ? "false" : "true",
    });
    await expect(notifyIncomingMessage("Private peer", "Private message")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not show a notification when browser permission is revoked", async () => {
    const called = vi.fn();
    vi.stubGlobal("window", { Notification: true });
    class DeniedNotification {
      static permission = "denied";
      constructor(title: string) { called(title); }
    }
    vi.stubGlobal("Notification", DeniedNotification);
    vi.stubGlobal("localStorage", { getItem: () => null });
    await notifyIncomingMessage("Private peer", "Private message");
    expect(called).not.toHaveBeenCalled();
  });

  it("does not expose private sender or text when preview privacy is on", async () => {
    const shown: Array<{ title: string; body?: string }> = [];
    vi.stubGlobal("window", { Notification: true });
    class AllowedNotification {
      static permission = "granted";
      constructor(title: string, options: { body?: string }) {
        shown.push({ title, body: options.body });
      }
    }
    vi.stubGlobal("Notification", AllowedNotification);
    vi.stubGlobal("localStorage", { getItem: () => null });
    await notifyIncomingMessage("Hidden peer", "Secret chat text");
    expect(shown).toEqual([{ title: "Trivo Chat", body: "Новое сообщение" }]);
  });
});
