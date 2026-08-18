// ============================================================================
//  Relative "go home" navigation.
//  ---------------------------------------------------------------------------
//  The Android APK loads the bundle from file:// (or https://localhost through
//  the Capacitor scheme), where an absolute "/" resolves to the filesystem root
//  and produces a blank WebView. Every recovery path in the app therefore has
//  to navigate RELATIVE to the currently loaded document.
// ============================================================================

/** Directory of the currently loaded document, always ending with "/". */
function currentDirectory(): string {
  const path = window.location.pathname;
  const dir = path.replace(/[^/]*$/, "");
  return dir.length > 0 ? dir : "./";
}

/**
 * URL of the app root, expressed relative to the current document.
 * Hash history (native builds) keeps the document and only resets the route.
 */
export function homeUrl(): string {
  if (typeof window === "undefined") return "./";
  const usesHashHistory =
    window.location.protocol === "file:" || window.location.hash.startsWith("#");
  if (usesHashHistory) return `${window.location.pathname}#/`;
  return currentDirectory();
}

/** Replace the current entry with the app root without touching the origin. */
export function goHome(): void {
  if (typeof window === "undefined") return;
  window.location.replace(homeUrl());
}
