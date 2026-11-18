import { describe, expect, it } from "vitest";
import { safeLifecycleMap } from "../sync/message-lifecycle";

describe("safe chat lifecycle projection from durable records", () => {
  it("does not let a damaged row replace the real message ID", () => {
    const map = safeLifecycleMap({
      "original": { messageId:"other", editedText:"new text", isEdited:true,
        updatedAt:10, unrelatedSecret:"untrusted" },
    });
    expect(map.original).toEqual({
      messageId:"original", editedText:"new text", isEdited:true, updatedAt:10,
    });
    expect(Object.hasOwn(map.original as object, "unrelatedSecret")).toBe(false);
  });
  it("does not inherit modified prototype keys or drop legitimate messages", () => {
    const hostile = Object.create(null) as Record<string, Record<string, unknown>>;
    hostile["__proto__"] = { editedText: "not a prototype" };
    hostile["normal"] = { pinnedAt:123, pinnedBy:"owner" };
    const result = safeLifecycleMap(hostile);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(result.normal.pinnedAt).toBe(123);
    expect(result["__proto__"].messageId).toBe("__proto__");
  });
  it("ignores malformed legacy values, retaining permitted data", () => {
    const rows = {
      a: { editedText:123, isEdited:"true", deletedForEveryone:false,
        updatedAt:Infinity, pinnedAt:-1 },
      b: [] as unknown as Record<string, unknown>,
    };
    const result = safeLifecycleMap(rows);
    expect(result.a).toEqual({messageId:"a",deletedForEveryone:false});
    expect(Object.hasOwn(result, "b")).toBe(false);
  });
});
