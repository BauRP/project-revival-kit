import { describe, expect, it } from "vitest";
import { assertEmptyTransferTarget } from "../identity-transfer";

const empty = () => ({
  contacts: 0, messages: 0, outbox: 0, inbox: 0,
  lifecycle: 0, blobs: 0, partialChunks: 0, legacyMessages: 0,
});
describe("fresh device identity migration safeguards", () => {
  it("permits a truly unused identity", () => {
    expect(() => assertEmptyTransferTarget(empty())).not.toThrow();
  });
  it("rejects every local data store that could be orphaned", () => {
    for (const name of Object.keys(empty()) as Array<keyof ReturnType<typeof empty>>) {
      expect(() => assertEmptyTransferTarget({ ...empty(), [name]: 1 })).toThrow(/fresh installation/);
    }
  });
});
