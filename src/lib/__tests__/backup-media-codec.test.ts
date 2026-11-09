import { describe, expect, it } from "vitest";
import { decodePortableMedia, encodePortableMedia } from "../backup-media-codec";

describe("portable attachment streaming codec (V3 backward compatible)", () => {
  for (const size of [0,1,2,3,4,32767,98303,98304,98305,98306,196607,262144]) {
    it(`round-trips ${size} arbitrary binary bytes with identical Base64 format`, async () => {
      const content = new Uint8Array(size);
      for (let i = 0; i < content.length; i++) content[i] = (i * 37 + 19) % 256;
      const encoded = await encodePortableMedia(new Blob([content], {type:"image/png"}));
      const restored = decodePortableMedia(encoded, "image/png");
      expect(restored.size).toBe(size);
      expect(restored.type).toBe("image/png");
      expect(new Uint8Array(await restored.arrayBuffer())).toEqual(content);
      // Compare with a completely independent legacy one-pass btoa.
      let legacy = "";
      for (let i=0;i<content.length;i++) legacy+=String.fromCharCode(content[i]);
      expect(encoded).toBe(btoa(legacy));
    });
  }
  it("does not swallow damaged backup Base64", () => {
    expect(() => decodePortableMedia("AA", "image/png")).toThrow();
    expect(() => decodePortableMedia("!!==", "image/png")).toThrow();
  });
});
