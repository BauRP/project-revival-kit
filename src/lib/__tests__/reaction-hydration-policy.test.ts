import { describe, it, expect } from "vitest";
import { normalizeLegacyReactions } from "../reaction-policy";

describe("bounded recovery of legacy reaction IDs", () => {
  it("does not load identifiers that exceed canonical message limits", () => {
    const legacy = {
      safe: { alice: "👍" },
      ["a".repeat(129)]: { attacker: "❤️" },
      ["bad\nname"]: { attacker: "❤️" },
    };
    const map = normalizeLegacyReactions(legacy);
    expect(Object.keys(map)).toEqual(["safe"]);
  });
});
