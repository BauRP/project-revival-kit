import { describe, expect, it } from "vitest";
import { isPreviouslyHiddenMessage } from "../hidden-message-migration";
describe("upgrade from visual-only deletion", () => {
  it("migrates both globally and locally hidden messages", () => {
    expect(isPreviouslyHiddenMessage({ deletedForEveryone:true },"self")).toBe(true);
    expect(isPreviouslyHiddenMessage({ deletedFor:["self"] },"self")).toBe(true);
    expect(isPreviouslyHiddenMessage({ deletedFor:["other"] },"self")).toBe(false);
    expect(isPreviouslyHiddenMessage({ editedText:"hi" },"self")).toBe(false);
  });
  it("fails closed on malformed lifecycle records", () => {
    expect(isPreviouslyHiddenMessage(null,"self")).toBe(false);
    expect(isPreviouslyHiddenMessage([],"self")).toBe(false);
    expect(isPreviouslyHiddenMessage({ deletedFor:"self" },"self")).toBe(false);
  });
});
