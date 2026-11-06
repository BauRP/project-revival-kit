import { describe, expect, it } from "vitest";
import { mergeConversationRows } from "../conversation-index-policy";
describe("indexed conversation lookup", () => {
  it("merges sent and received records chronologically without duplicates", () => {
    const a={id:"a",timestamp:3}, b={id:"b",timestamp:1};
    const c={id:"c",timestamp:2};
    expect(mergeConversationRows([a,b],[a,c],10).map(x=>x.id))
      .toEqual(["b","c","a"]);
  });
  it("preserves expiration semantics for private messages", () => {
    const expired={id:"old",timestamp:1,deleteAt:100};
    const alive={id:"new",timestamp:2,deleteAt:101};
    expect(mergeConversationRows([expired,alive],[],100).map(x=>x.id))
      .toEqual(["new"]);
  });
  it("breaks same-timestamp ties by identity deterministically", () => {
    expect(mergeConversationRows([{id:"z",timestamp:1}],[{id:"a",timestamp:1}],2)
      .map(x=>x.id)).toEqual(["a","z"]);
  });
});
