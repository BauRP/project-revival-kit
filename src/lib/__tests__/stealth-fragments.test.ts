import { describe, expect, it } from "vitest";
import { fragmentMessage, reassembleFragments } from "../stealth";
describe("local-only text fragment integrity", () => {
  it("reassembles out of order without mutating the caller's array", () => {
    const chunks = fragmentMessage("id", "alphabet", 3);
    const shuffled = [...chunks].reverse();
    expect(reassembleFragments(shuffled)).toBe("alphabet");
    expect(shuffled[0].index).toBe(2);
  });
  it("refuses duplicate, missing and contradictory fragments", () => {
    const chunks = fragmentMessage("id", "abcde", 2);
    expect(() => reassembleFragments(chunks.slice(0,2))).toThrow();
    expect(() => reassembleFragments([chunks[0],chunks[0],chunks[2]])).toThrow();
    expect(() => reassembleFragments([chunks[0],{...chunks[1],messageId:"forged"},chunks[2]])).toThrow();
  });
  it("limits excessive plaintext and unsafe splitting parameters", () => {
    expect(() => fragmentMessage("id", "text", 0)).toThrow();
    expect(() => fragmentMessage("id", "text", -1)).toThrow();
    expect(() => fragmentMessage("id", "a".repeat(200001), 8)).toThrow();
  });
});
