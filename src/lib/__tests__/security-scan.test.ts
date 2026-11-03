import { describe, it, expect } from "vitest";
import { inspectAttachmentHeader, inspectAttachmentBlob, canScrubImageType, safeScrubCanvasSize } from "../security-scan";

const check = (name: string, mime: string, bytes: number[]) =>
  inspectAttachmentHeader(name, mime, new Uint8Array(bytes));

describe("offline attachment header policy", () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  it("accepts a genuine PNG and JPEG image", () => {
    expect(check("photo.png", "image/png", png).safe).toBe(true);
    expect(check("photo.jpg", "image/jpeg", [0xff, 0xd8, 0xff, 0xe0]).safe).toBe(true);
  });
  it("rejects disguised executables regardless of file extension", () => {
    expect(check("photo.png", "image/png", [0x4d, 0x5a, 0x90]).safe).toBe(false);
    expect(check("notes.txt", "text/plain", [0x7f, 0x45, 0x4c, 0x46]).safe).toBe(false);
    expect(check("song.mp3", "audio/mpeg", [0x23, 0x21, 0x2f]).safe).toBe(false);
  });
  it("rejects forged image MIME and active documents", () => {
    expect(check("photo.jpg", "image/jpeg", png).safe).toBe(false);
    expect(check("vector.svg", "image/svg+xml", [...new TextEncoder().encode("<svg>")]).safe).toBe(false);
    expect(check("page.txt", "text/plain", [...new TextEncoder().encode("<script>")]).safe).toBe(false);
  });
  it("does not incorrectly claim a plain text document contains no malware", () => {
    expect(check("letter.txt", "text/plain", [...new TextEncoder().encode("hello")]).safe).toBe(true);
  });
});

describe("metadata privacy policy", () => {
  it("allows only image formats that the local encoder can safely scrub", () => {
    expect(canScrubImageType("image/jpeg")).toBe(true);
    expect(canScrubImageType("image/png")).toBe(true);
    expect(canScrubImageType("image/webp")).toBe(true);
    expect(canScrubImageType("image/bmp")).toBe(true);
    expect(canScrubImageType("image/gif")).toBe(false);
    expect(canScrubImageType("image/heic")).toBe(false);
  });

  it("rejects images with no declared MIME, preventing unsanitized upload", () => {
    expect(check("photo.jpg", "", [0xff, 0xd8, 0xff, 0xe0]).safe).toBe(false);
    expect(check("photo.txt", "text/plain", [0xff, 0xd8, 0xff, 0xe0]).safe).toBe(false);
    expect(check("photo.bin", "application/octet-stream", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).safe).toBe(false);
  });
});

describe("received attachment safety", () => {
  it("rejects a remote executable disguised as a text file before preview", async () => {
    const blob = new Blob([new Uint8Array([0x4d, 0x5a, 0x90])]);
    expect((await inspectAttachmentBlob("readme.txt", "text/plain", blob)).safe).toBe(false);
  });
  it("accepts a correctly labelled PNG from Tor", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
    expect((await inspectAttachmentBlob("pic.png", "image/png", blob)).safe).toBe(true);
  });
});

describe("bounded metadata-stripping canvas for high-resolution phones", () => {
  it("keeps a normal screenshot at its original dimensions", () => {
    expect(safeScrubCanvasSize(1920,1080)).toEqual({width:1920,height:1080});
  });
  it("downsamples a 50 MP camera photo before allocating a canvas", () => {
    const size = safeScrubCanvasSize(8192,6144);
    expect(size.width).toBe(4096);
    expect(size.height).toBe(3072);
  });
  it("fails closed on impossible and corrupted dimensions", () => {
    expect(() => safeScrubCanvasSize(0,100)).toThrow();
    expect(() => safeScrubCanvasSize(2e9,2e9)).toThrow();
    expect(() => safeScrubCanvasSize(NaN,1)).toThrow();
  });
});

describe("untrusted attachment path and script suffixes", () => {
  const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0]);
  it("rejects executable double extensions even with valid JPEG signatures", () => {
    expect(inspectAttachmentHeader("invoice.apk.jpg","image/jpeg",jpeg).safe).toBe(false);
    expect(inspectAttachmentHeader("script.ps1.txt","text/plain",new Uint8Array([0x61])).safe).toBe(false);
  });
  it("rejects a path separator in any peer-supplied filename", () => {
    expect(inspectAttachmentHeader("../photo.jpg","image/jpeg",jpeg).safe).toBe(false);
    expect(inspectAttachmentHeader("dir\\photo.jpg","image/jpeg",jpeg).safe).toBe(false);
  });
  it("rejects direct scripts even when their content looks benign", () => {
    expect(inspectAttachmentHeader("run.ps1","text/plain",new Uint8Array([0x61])).safe).toBe(false);
    expect(inspectAttachmentHeader("run.sh","text/plain",new Uint8Array([0x61])).safe).toBe(false);
  });
});
