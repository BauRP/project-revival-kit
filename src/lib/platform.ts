// ============================================================================
//  Platform detection helpers.
//  ---------------------------------------------------------------------------
//  Every native bridge (Tor foreground service, biometrics, native filesystem,
//  native outbox) must be probed through these helpers. They never throw:
//  during SSR / prerender there is no `window` and no Capacitor bridge, and in
//  the web preview the Capacitor runtime reports platform "web".
//
//  IMPORTANT: these helpers only *gate* execution. The native implementations
//  themselves are untouched and run in full when the APK is installed.
// ============================================================================

import { Capacitor } from "@capacitor/core";

/** True only inside a real browser/WebView document (false during SSR). */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** True when running inside the Capacitor Android/iOS shell. */
export function isNative(): boolean {
  if (!isBrowser()) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True in the Lovable web preview / any plain browser. */
export function isWebPreview(): boolean {
  return isBrowser() && !isNative();
}

/** Current platform string, safe on the server. */
export function platform(): "web" | "android" | "ios" | "server" {
  if (!isBrowser()) return "server";
  try {
    return Capacitor.getPlatform() as "web" | "android" | "ios";
  } catch {
    return "web";
  }
}

/** True when a specific Capacitor plugin is actually available natively. */
export function hasNativePlugin(name: string): boolean {
  if (!isNative()) return false;
  try {
    return Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}

/**
 * Run `fn` and swallow any failure, returning `fallback` instead.
 * Used around native bridge calls so a missing plugin in the web preview can
 * never bubble up into a React render and blank the app.
 */
export async function safeNative<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[platform] native call failed, using web fallback:", error);
    }
    return fallback;
  }
}

/** Synchronous variant of `safeNative`. */
export function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[platform] call failed, using fallback:", error);
    }
    return fallback;
  }
}
