// On-the-fly image compression.
// Any image > 500 KB OR with a longest edge > 1080 px is resized + re-encoded
// to JPEG/WebP targeting ~300 KB. Non-image files pass through untouched.
//
// Pure browser implementation using <canvas> + HTMLImageElement — no
// dependencies. Returns a File so the existing upload pipeline can keep its
// filename/mime contract.

const MAX_LONG_EDGE = 1080;
const SIZE_TRIGGER_BYTES = 500 * 1024;
const TARGET_BYTES = 300 * 1024;
const MIN_QUALITY = 0.5;

function isImageFile(file: File | Blob): boolean {
  return typeof file.type === "string" && file.type.startsWith("image/");
}

function pickOutputMime(originalMime: string): string {
  // Preserve transparency where it matters; everything else → JPEG.
  if (originalMime === "image/png" || originalMime === "image/webp") {
    // WebP gives us better ratio at the same quality for both.
    return "image/webp";
  }
  return "image/jpeg";
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      mime,
      quality,
    );
  });
}

export interface CompressionResult {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  compressed: boolean;
}

export async function compressImage(file: File | Blob): Promise<CompressionResult> {
  const originalSize = file.size;
  const originalMime = file.type || "image/jpeg";

  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  const outMime = pickOutputMime(originalMime);

  // Iterative quality reduction until we land at or below the target,
  // never dropping below MIN_QUALITY.
  let quality = 0.85;
  let out = await canvasToBlob(canvas, outMime, quality);
  while (out.size > TARGET_BYTES && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.1);
    out = await canvasToBlob(canvas, outMime, quality);
  }

  return {
    blob: out,
    mime: outMime,
    width,
    height,
    originalSize,
    compressedSize: out.size,
    compressed: true,
  };
}

/**
 * Public entry point. Returns the original file unchanged when:
 *   - it isn't an image, OR
 *   - it is already <= 500 KB AND <= 1080p.
 * Otherwise returns a compressed File with a normalized extension.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!isImageFile(file)) return file;

  // Cheap pre-check: small enough by weight AND likely small enough by pixels.
  if (file.size <= SIZE_TRIGGER_BYTES) {
    try {
      const probe = await loadImage(file);
      const longEdge = Math.max(probe.naturalWidth, probe.naturalHeight);
      if (longEdge <= MAX_LONG_EDGE) return file;
    } catch {
      return file;
    }
  }

  try {
    const result = await compressImage(file);
    // Skip the swap if compression actually made it bigger (rare for tiny PNGs).
    if (result.compressedSize >= file.size) return file;

    const ext = result.mime === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([result.blob], `${baseName}.${ext}`, { type: result.mime });
  } catch (e) {
    console.warn("[image-compress] failed, using original:", e);
    return file;
  }
}
