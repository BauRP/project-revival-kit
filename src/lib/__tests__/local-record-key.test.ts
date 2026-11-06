import { describe, it, expect } from "vitest";
import {
  createWrappedLocalRecordKey, openWrappedLocalRecordKey,
} from "../local-record-key";

describe("Android-only local data master key lifecycle", () => {
  it("does not create or unlock an unprotected browser master key", async () => {
    await expect(createWrappedLocalRecordKey()).rejects.toThrow("Android Keystore");
    await expect(openWrappedLocalRecordKey("untrusted-wrapper"))
      .rejects.toThrow("Android Keystore");
  });
});
