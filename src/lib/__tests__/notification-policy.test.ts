import { describe, expect, it } from "vitest";
import { shouldNotifyChat, safeNotificationText, nextLocalNotificationId } from "../notification-policy";

describe("offline notification privacy", () => {
  it("suppresses disabled, muted, blocked and silent notifications", () => {
    expect(shouldNotifyChat({enabled:false})).toBe(false);
    expect(shouldNotifyChat({enabled:true,mutedUntil:200},100)).toBe(false);
    expect(shouldNotifyChat({enabled:true,blocked:true})).toBe(false);
    expect(shouldNotifyChat({enabled:true,silent:true})).toBe(false);
    expect(shouldNotifyChat({enabled:true,mutedUntil:99},100)).toBe(true);
  });
  it("hides sender and message text when preview privacy is enabled", () => {
    expect(safeNotificationText("Private contact","confidential",true)).toEqual({
      title:"Trivo Chat",body:"Новое сообщение",
    });
    expect(safeNotificationText("Peer","Hello",false)).toEqual({title:"Peer",body:"Hello"});
  });
  it("removes invisible controls and line breaks from untrusted remote names", () => {
    expect(safeNotificationText("Peer\nSystem", "Hello\r\nworld", false))
      .toEqual({title:"Peer System",body:"Hello world"});
    expect(safeNotificationText("", "", false)).toEqual({
      title:"Trivo Chat",body:"Новое сообщение",
    });
  });
  it("never replaces two consecutive messages due to the same Android ID", () => {
    const first=nextLocalNotificationId(), second=nextLocalNotificationId();
    expect(first).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });
});

import { notificationPreferenceUnavailable } from "../notification-policy";
describe("notification preference storage failures", () => {
  it("fails closed when notifications cannot be checked", () => {
    expect(notificationPreferenceUnavailable("trivo-notifications",true)).toBe(false);
    expect(notificationPreferenceUnavailable("trivo-hide-content",false)).toBe(true);
  });
});
