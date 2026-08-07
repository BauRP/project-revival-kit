// Phase 3 §4 — Data Saver: detects connection type and gates auto-download.
// Uses the Network Information API on Android Chrome / WebView (API 36 OK).

export type ConnectionKind = "wifi" | "cellular" | "unknown";

const STORAGE_KEY = "trivo-data-saver";

export function isDataSaverEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setDataSaverEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent("trivo:data-saver", { detail: enabled }));
  } catch {
    /* ignore */
  }
}

export function getConnectionKind(): ConnectionKind {
  try {
    const c = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!c) return "unknown";
    // ConnectivityManager-equivalent: type === "wifi" | "cellular" | "ethernet" | ...
    if (c.type === "wifi" || c.type === "ethernet") return "wifi";
    if (c.type === "cellular" || c.saveData === true) return "cellular";
    // effectiveType heuristic
    if (typeof c.effectiveType === "string") {
      if (c.effectiveType === "4g" && !c.saveData) return "wifi";
      return "cellular";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Returns true when media of the given kind should auto-download.
 * Cellular + DataSaver ON = block all auto-download → "Tap to download" placeholder.
 */
export function shouldAutoDownload(_kind: "image" | "video" | "file" | "audio"): boolean {
  if (!isDataSaverEnabled()) return true;
  return getConnectionKind() === "wifi";
}
