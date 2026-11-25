import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePrivateImage, encodePrivateCanvas } from "../security-scan";

afterEach(() => {
  vi.useRealTimers();
});

describe("private image metadata stripping cannot hang indefinitely", () => {
  it("releases image listeners after a successful decode", async () => {
    vi.useFakeTimers();
    const image = { src: "", onload: null, onerror: null } as unknown as HTMLImageElement;
    const pending = decodePrivateImage(image, "blob:local");
    expect(image.src).toBe("blob:local");
    image.onload?.(new Event("load"));
    await expect(pending).resolves.toBeUndefined();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled decoder without returning an EXIF-bearing original", async () => {
    vi.useFakeTimers();
    const image = { src: "", onload: null, onerror: null } as unknown as HTMLImageElement;
    const pending = decodePrivateImage(image, "blob:private", 100);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(image.src).toBe("");
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });

  it("ignores a late canvas callback after timeout", async () => {
    vi.useFakeTimers();
    let callback: ((blob: Blob | null) => void) | undefined;
    const canvas = {
      toBlob: (cb: (blob: Blob | null) => void) => { callback = cb; },
    } as unknown as HTMLCanvasElement;
    const pending = encodePrivateCanvas(canvas, "image/png", 100);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    callback?.(new Blob(["data"], { type: "image/png" }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts correct encoded bytes and rejects mismatched media types", async () => {
    vi.useFakeTimers();
    const success = { toBlob: (cb: (blob: Blob | null) => void) =>
      cb(new Blob(["safe"], { type: "image/png" })) } as unknown as HTMLCanvasElement;
    await expect(encodePrivateCanvas(success, "image/png")).resolves.toMatchObject({
      type: "image/png", size: 4,
    });
    const mismatch = { toBlob: (cb: (blob: Blob | null) => void) =>
      cb(new Blob(["unsafe"], { type: "image/jpeg" })) } as unknown as HTMLCanvasElement;
    await expect(encodePrivateCanvas(mismatch, "image/png")).rejects.toThrow(/verify/);
    expect(vi.getTimerCount()).toBe(0);
  });
});
