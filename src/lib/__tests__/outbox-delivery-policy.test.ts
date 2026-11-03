import { describe, expect, it } from "vitest";
import { mayQueueOriginalText } from "../outbox-delivery-policy";
describe("outgoing text deletion races", () => {
  it("forbids re-enqueue after a local deletion, including scheduled sends", () => {
    expect(mayQueueOriginalText({deleted:true,deletedAt:123})).toBe(false);
    expect(mayQueueOriginalText({deleted:false})).toBe(true);
    expect(mayQueueOriginalText(undefined)).toBe(true);
  });
});
