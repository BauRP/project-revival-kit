import { describe, expect, it } from "vitest";
import { mayUpgradeLegacyChunk } from "../legacy-chunk-migration";

const original = {
  key: "f:s:0", fileId: "f", from: "peer", index: 0,
  digest: "signed-digest", updatedAt: 42,
  data: new Blob([Uint8Array.from([1,2,3])]),
};
describe("idempotent legacy Tor chunk upgrade", () => {
  it("upgrades only the exact same legacy row", () => {
    expect(mayUpgradeLegacyChunk(original, {...original})).toBe(true);
  });
  it("never recreates a deleted, replaced or sealed chunk", () => {
    expect(mayUpgradeLegacyChunk(original, undefined)).toBe(false);
    expect(mayUpgradeLegacyChunk(original, {...original,encrypted:1})).toBe(false);
    expect(mayUpgradeLegacyChunk(original, {...original,updatedAt:43})).toBe(false);
    expect(mayUpgradeLegacyChunk(original, {...original,digest:"new"})).toBe(false);
    expect(mayUpgradeLegacyChunk(original, {...original,fileId:"other"})).toBe(false);
    expect(mayUpgradeLegacyChunk(original, {...original,data:new Blob([Uint8Array.from([0])])})).toBe(false);
  });
});
