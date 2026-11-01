import { describe, expect, it } from "vitest";
import { shouldNotifyChat, safeNotificationText } from "../notification-policy";
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
});