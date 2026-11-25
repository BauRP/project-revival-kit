/**
 * Read a user-chosen portable archive. File-picker cancellation is an actual
 * outcome, not a Promise left pending forever. This also keeps oversized
 * input out of WebView memory before calling File.text().
 */
import { assertBackupFileSize, MAX_BACKUP_FILE_BYTES } from "./backup-input-policy";

export function pickBackupFileAsText(
  createInput: () => HTMLInputElement = () => document.createElement("input"),
  readTimeoutMs = 120_000,
): Promise<string> {
  if (!Number.isSafeInteger(readTimeoutMs) || readTimeoutMs < 1 || readTimeoutMs > 600_000)
    return Promise.reject(new Error("Invalid backup read timeout"));
  return new Promise<string>((resolve, reject) => {
    const input = createInput();
    input.type = "file";
    input.accept = ".tvc,application/octet-stream,application/json";
    let settled = false;
    let readTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (readTimer !== null) {
        clearTimeout(readTimer);
        readTimer = null;
      }
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
    };
    const finish = (error: unknown, text?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(text ?? "");
    };
    const onCancel = () => finish(new Error("Backup file selection cancelled"));
    const onChange = () => {
      const file = input.files?.[0];
      if (!file) {
        finish(new Error("No backup file selected"));
        return;
      }
      // Never begin a second expensive read after duplicate change events.
      input.removeEventListener("change", onChange);
      // A stalled File.text() must not keep the restore screen waiting forever.
      // This timer cannot interrupt a completely blocked JS thread, but it
      // settles the restore when the browser still processes tasks.
      try {
        assertBackupFileSize(file.size);
        if (file.size === 0) throw new Error("Backup file is empty");
      } catch (error) {
        finish(error);
        return;
      }
      readTimer = setTimeout(() => {
        finish(new Error("Backup file read timed out; no data was restored"));
      }, readTimeoutMs);
      void (async () => {
        try {
          const text = await file.text();
          if (typeof text !== "string" || text.length > file.size)
            throw new Error("Backup file changed or returned invalid text while reading");
          if (text.length > MAX_BACKUP_FILE_BYTES)
            throw new Error("Backup file exceeds supported size");
          finish(null, text);
        } catch (error) {
          finish(error);
        }
      })();
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    try { input.click(); }
    catch (error) { finish(error); }
  });
}
