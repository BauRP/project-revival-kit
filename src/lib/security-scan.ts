// Conservative offline extension risk check; this is NOT antivirus scanning.
// Layer 1: EXIF/metadata stripping (pre-upload)
// Layer 2: Post-download threat simulation

export interface ScanResult {
  safe: boolean;
  threatType?: "virus" | "spyware" | "malware";
  fileName: string;
}

/**
 * Remove metadata from outgoing images. Fail closed: silently returning the
 * original image on a decoder/canvas failure leaks EXIF/GPS data.
 * Animated/HEIC/AVIF formats require a dedicated privacy-preserving encoder.
 */
export function canScrubImageType(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/bmp"].includes(mime.toLowerCase());
}

/**
 * Bound decoded canvas memory while preserving aspect ratio. 50-200 MP
 * phone images would otherwise allocate enormous RGBA canvases during EXIF
 * removal and crash the Android WebView before the file could be sent.
 */
export function safeScrubCanvasSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width > 65_535 || height > 65_535 ||
      width * height > 250_000_000)
    throw new Error("Image dimensions are unsupported for private metadata stripping");
  const max = 4096;
  const factor = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

export async function stripExifMetadata(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (!canScrubImageType(file.type))
    throw new Error("This image format cannot be safely stripped of private metadata");

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unable to decode image for metadata removal"));
      img.src = url;
    });
    const bounds = safeScrubCanvasSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Secure image re-encoding is unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Canvas normally does not encode BMP; use JPEG and update the filename.
    const outputType = file.type === "image/bmp" ? "image/jpeg" : file.type;
    const encoded = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0 || blob.type !== outputType)
          reject(new Error("Unable to verify metadata-free image output"));
        else resolve(blob);
      }, outputType, 0.92);
    });
    const filename = file.type === "image/bmp"
      ? file.name.replace(/\.bmp$/i, "") + ".jpg" : file.name;
    return new File([encoded], filename, { type: outputType, lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Conservative local extension policy, not a malware scan.
 * The return value only means the extension was not blocked.
 * Never advertise it as proof the file contains no malware.
 */
export function simulateSecurityScan(
  fileName: string,
  isInternalRecording: boolean = false,
): ScanResult {
  // Internal voice recordings bypass scanning
  if (isInternalRecording) {
    return { safe: true, fileName };
  }

  // Extension-only policy. This does not establish whether a file is malware.
  const suspicious = fileName.toLowerCase().match(/\.(exe|bat|cmd|scr|pif|vbs|js|mjs|cjs|wsf|com|ps1|psm1|sh|bash|command|reg|lnk|desktop)$/);
  if (suspicious) {
    return { safe: false, threatType: "malware", fileName };
  }

  return { safe: true, fileName };
}

/**
 * Offline signature checks for a file chosen for upload. A filename or MIME
 * type alone can be forged. This does NOT certify the file as malware-free.
 */
/** UTF-8 BOM and leading whitespace cannot disguise an executable document. */
export function isActiveContentHeader(header: Uint8Array): boolean {
  const head = new TextDecoder("utf-8").decode(header.subarray(0, 128))
    .replace(/^\uFEFF/, "").trimStart();
  return /^(?:#!|<\s*(?:!doctype\s+html|html|script|svg|iframe|object|embed)\b|<\?php\b)/i.test(head);
}

export function inspectAttachmentHeader(
  fileName: string, declaredMime: string, header: Uint8Array,
): ScanResult {
  const byName = simulateSecurityScan(fileName);
  if (!byName.safe) return byName;
  const blocked = (): ScanResult => ({ safe: false, threatType: "malware", fileName });
  const mime = declaredMime.toLowerCase().split(";")[0].trim();
  const name = fileName.toLowerCase();
  // Treat scripts, path spoofing and double executable extensions as unsafe
  // even when the declared final suffix looks like a supported image.
  if (!name || name.length > 255 ||
      /[\u0000-\u001f\u007f\\/]/.test(name) ||
      /\.(exe|bat|cmd|scr|pif|vbs|js|mjs|cjs|wsf|com|ps1|hta|apk|jar|dex|so|dll|msi|lnk|desktop)\./i.test(name))
    return blocked();
  const starts = (...bytes: number[]) => bytes.every((b, i) => header[i] === b);
  const ascii = (start: number, count: number) =>
    String.fromCharCode(...header.subarray(start, start + count));
  // Known executable formats, scripts and active HTML/SVG are not safe to
  // silently accept just because they have been renamed to .jpg or .txt.
  if (starts(0x4d, 0x5a) || starts(0x7f, 0x45, 0x4c, 0x46) ||
      starts(0x23, 0x21) || starts(0xfe, 0xed, 0xfa, 0xce) ||
      starts(0xcf, 0xfa, 0xed, 0xfe) ||
      isActiveContentHeader(header))
    return blocked();
  if (/\.(svg|svgz|html?|xhtml|hta|apk|jar|dex|so|dll|msi)$/i.test(name) ||
      mime === "image/svg+xml" || mime === "text/html" ||
      mime === "application/x-msdownload")
    return blocked();

  const detectedImage =
    starts(0xff, 0xd8, 0xff) ? "image/jpeg" :
    starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? "image/png" :
    (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") ? "image/gif" :
    (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") ? "image/webp" :
    starts(0x42, 0x4d) ? "image/bmp" :
    (ascii(4, 4) === "ftyp" && /^(heic|heix|hevc|mif1)$/.test(ascii(8, 4))) ? "image/heic" :
    (ascii(4, 4) === "ftyp" && /^(avif|avis)$/.test(ascii(8, 4))) ? "image/avif" :
    null;

  // A renamed/incorrectly labelled image must never bypass metadata
  // stripping by claiming to be text/plain or application/octet-stream.
  if (detectedImage && !mime.startsWith("image/")) return blocked();
  if (mime.startsWith("image/")) {
    const normalMime = mime === "image/jpg" ? "image/jpeg" :
      mime === "image/heif" ? "image/heic" : mime;
    if (!detectedImage || normalMime !== detectedImage) return blocked();
  }
  // A PDF declaring itself to be an image or vice versa is rejected above.
  // Non-image types are still untrusted attachments, never "scanned clean".
  return { safe: true, fileName };
}

export async function inspectAttachmentBlob(
  name: string, mimeType: string, blob: Blob,
): Promise<ScanResult> {
  // Verify the real bytes on both upload and received-file paths.
  // Only read a fixed-size signature, not the full file.
  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  return inspectAttachmentHeader(name, mimeType, header);
}

export async function inspectAttachmentFile(file: File): Promise<ScanResult> {
  return inspectAttachmentBlob(file.name, file.type, file);
}

/**
 * Get localized blocked file message
 */
export function getBlockedFileMessage(
  lang: string,
  type: "photo" | "file",
): { title: string; footer: string } {
  if (lang === "ru" || lang === "kk") {
    const item = type === "photo" ? "фото" : "файл";
    return {
      title: `Небезопасный тип файла: ${item}`,
      footer: "Файл заблокирован из-за потенциально опасного расширения. Антивирусная проверка не проводилась.",
    };
  }
  const item = type === "photo" ? "photo" : "file";
  return {
    title: `Potentially unsafe file type: ${item}`,
    footer: "Blocked due to file extension. No antivirus scan was performed.",
  };
}
