/**
 * Read a user-chosen portable archive. File-picker cancellation is an actual
 * outcome, not a Promise left pending forever. This also keeps oversized
 * input out of WebView memory before calling File.text().
 */
import { assertBackupFileSize, MAX_BACKUP_FILE_BYTES } from "./backup-input-policy";

export function pickBackupFileAsText(
  createInput: () => HTMLInputElement = () => document.createElement("input"),
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const input = createInput();
    input.type = "file";
    input.accept = ".tvc,application/octet-stream,application/json";
    let settled = false;

    const cleanup = () => {
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
      void (async () => {
        try {
          assertBackupFileSize(file.size);
          if (file.size === 0) throw new Error("Backup file is empty");
          const text = await file.text();
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
