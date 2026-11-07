import { describe, expect, it } from "vitest";
import {
  canReactToVisibleMessage, pruneDeletedReactionMap,
} from "../reaction-deletion-policy";

const me = "me.onion", peer = "peer.onion";
const sent = {id:"m",from:me,to:peer};
const incoming = {id:"m",from:peer,to:me};
describe("deleted message cannot regain a remote or locally queued reaction", () => {
  it("accepts only a live message shared by exact participants", () => {
    expect(canReactToVisibleMessage(sent,peer,me,undefined)).toBe(true);
    expect(canReactToVisibleMessage(incoming,peer,me,undefined)).toBe(true);
    expect(canReactToVisibleMessage({...sent,to:"third"},peer,me,undefined)).toBe(false);
    expect(canReactToVisibleMessage({...sent,id:""},peer,me,undefined)).toBe(false);
    expect(canReactToVisibleMessage(undefined,peer,me,undefined)).toBe(false);
  });
  it("refuses late authenticated reactions after delete-for-me or expiry", () => {
    for (const message of [sent,incoming]) {
      expect(canReactToVisibleMessage(message,peer,me,{deleted:true,deletedAt:12})).toBe(false);
    }
    expect(canReactToVisibleMessage(incoming,peer,me,{deleted:false})).toBe(true);
  });
  it("does not resurrect deleted legacy reactions when merging saved maps", () => {
    const map = {"removed":{alice:"❤️"},"live":{bob:"👍"}};
    const filtered = pruneDeletedReactionMap(map,new Set(["removed"]));
    expect(filtered).toEqual({live:{bob:"👍"}});
    expect(Object.getPrototypeOf(filtered)).toBeNull();
    expect(map.removed).toBeDefined();
  });
  it("cannot inject an inherited identifier into a reaction dictionary", () => {
    const map = Object.create(null) as Record<string,string>;
    map["__proto__"] = "unsafe";
    map["safe"] = "ok";
    const filtered = pruneDeletedReactionMap(map, new Set(["__proto__"]));
    expect(filtered.safe).toBe("ok");
    expect(Object.prototype.hasOwnProperty.call(filtered,"__proto__")).toBe(false);
  });
});
