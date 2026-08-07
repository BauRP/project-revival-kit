// ============================================================================
//  Native bridge readiness gate.
//  ---------------------------------------------------------------------------
//  Calling a Capacitor plugin before the native bridge has injected its
//  JavaScript layer throws synchronously inside the Android WebView. When that
//  happens during the first render pass React unmounts the whole tree and the
//  OS surfaces "Trivo Chat Elite keeps stopping".
//
//  Every startup routine that touches a plugin must await `whenBridgeReady()`
//  first and go through `runNative()` / `runNativeOptional()`, which:
//    * resolve immediately (with the web fallback) in the browser preview,
//    * wait for DOMContentLoaded + `deviceready` on native,
//    * never reject — failures are logged and the fallback value is returned.
// ============================================================================

import { Capacitor } from "@capacitor/core";
import { isBrowser, isNative, hasNativePlugin } from "@/lib/platform";

let readyPromise: Promise<void> | null = null;

function waitForDomReady(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
      resolve();
      return;
    }
    const onReady = () => {
      document.removeEventListener("DOMContentLoaded", onReady);
      resolve();
    };
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
    // Hard safety net: never hang the boot sequence on a missing event.
    setTimeout(resolve, 4000);
  });
}

function waitForDeviceReady(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    // Capacitor 8 exposes the bridge synchronously once the WebView is wired.
    try {
      const bridged = (window as unknown as { Capacitor?: { isNative?: boolean } }).Capacitor;
      if (bridged?.isNative) {
        resolve();
        return;
      }
    } catch {
      /* fall through to the event path */
    }
    const onDeviceReady = () => {
      document.removeEventListener("deviceready", onDeviceReady);
      resolve();
    };
    document.addEventListener("deviceready", onDeviceReady, { once: true });
    // Capacitor apps without Cordova plugins may never emit `deviceready`.
    setTimeout(resolve, 3000);
  });
}

/** Resolves when it is safe to touch native plugins (or right away on web). */
export function whenBridgeReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (!isBrowser()) return;
    if (!isNative()) return;
    await waitForDomReady();
    await waitForDeviceReady();
  })();
  return readyPromise;
}

/**
 * Runs a native-only routine after the bridge is ready.
 * On web (or when the plugin is not installed) the fallback is returned and the
 * native code is never evaluated.
 */
export async function runNative<T>(
  pluginName: string | null,
  fn: () => Promise<T> | T,
  fallback: T,
  label = "native call",
): Promise<T> {
  try {
    await whenBridgeReady();
    if (!isNative()) return fallback;
    if (pluginName && !hasNativePlugin(pluginName)) {
      console.warn(`[trivo] plugin "${pluginName}" unavailable — using fallback for ${label}.`);
      return fallback;
    }
    return await fn();
  } catch (error) {
    console.warn(`[trivo] ${label} failed, using fallback:`, error);
    return fallback;
  }
}

/**
 * Runs a routine that has both a native and a web implementation. Both branches
 * are individually guarded so neither can bubble an exception into React.
 */
export async function runEither<T>(
  options: { native: () => Promise<T> | T; web: () => Promise<T> | T; label?: string },
  fallback: T,
): Promise<T> {
  const label = options.label ?? "bridged call";
  try {
    await whenBridgeReady();
    return await (isNative() ? options.native() : options.web());
  } catch (error) {
    console.warn(`[trivo] ${label} failed, using fallback:`, error);
    return fallback;
  }
}

/** Best-effort platform label, useful for diagnostics screens. */
export function bridgeInfo(): { platform: string; native: boolean; pluginsReady: boolean } {
  let platform = "server";
  let native = false;
  try {
    if (isBrowser()) {
      platform = Capacitor.getPlatform();
      native = Capacitor.isNativePlatform();
    }
  } catch {
    platform = "web";
  }
  return { platform, native, pluginsReady: readyPromise !== null };
}
