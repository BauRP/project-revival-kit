import { describe, it, expect } from "vitest";
import { inspectAttachmentHeader, inspectAttachmentBlob, canScrubImageType } from "../security-scan";

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
