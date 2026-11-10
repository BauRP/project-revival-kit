import { useEffect, useSyncExternalStore } from "react";
import { App, type AppState } from "@capacitor/app";
import { whenBridgeReady, runNative } from "@/lib/native-bridge";
import { safeStorage, isStorageAvailable } from "@/lib/safe-storage";
import { isNative } from "@/lib/platform";
import { createBiometricStore, initialBiometricLocked } from "@/lib/biometric-state";

const BIOMETRIC_KEY = "trivo-biometric";
const initiallyEnabled = safeStorage.get(BIOMETRIC_KEY) === "true";
const state = createBiometricStore({
  isAvailable: false,
  isEnabled: initiallyEnabled,
  // Lock synchronously, before the first React paint or native bridge call.
  isLocked: initialBiometricLocked(initiallyEnabled, isNative()),
});

let bootstrap: Promise<void> | null = null;

/** Never unlock after an unavailable plugin, failed prompt, or cancelled scan. */
async function authenticateBiometric(): Promise<boolean> {
  if (!isNative()) {
    state.update({ isLocked: false });
    return true;
  }
  try {
    await whenBridgeReady();
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason: "Unlock Trivo Chat",
      cancelTitle: "Cancel",
    });
    state.update({ isLocked: false });
    return true;
  } catch (error) {
    console.warn("[trivo] biometric authentication was not completed", error);
    return false;
  }
}

function initializeBiometricOnce(): Promise<void> {
  if (bootstrap) return bootstrap;
  bootstrap = (async () => {
    await whenBridgeReady();
    if (!isNative()) return;
    try {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      const result = await BiometricAuth.checkBiometry();
      state.update({ isAvailable: result.isAvailable });
    } catch (error) {
      state.update({ isAvailable: false });
      console.warn("[trivo] cannot check biometric hardware", error);
    }

    // One native listener for the whole application, not one per Settings
    // instance. A foreground return re-locks every subscribing screen.
    await runNative(
      "App",
      async () => App.addListener("appStateChange", (event: AppState) => {
        if (event.isActive && state.getSnapshot().isEnabled)
          state.update({ isLocked: true });
      }),
      null,
      "biometric appStateChange listener",
    );

    if (state.getSnapshot().isEnabled) {
      // A failed or unavailable native prompt keeps isLocked=true.
      await authenticateBiometric();
    }
  })().catch((error) => {
    // Do not hide the lock overlay when startup fails.
    console.warn("[trivo] biometric initialization failed", error);
  });
  return bootstrap;
}

async function toggleBiometric(): Promise<void> {
  const enabled = state.getSnapshot().isEnabled;
  if (!enabled) {
    // A plain browser has no native BiometricAuth prompt. Claiming the
    // preference is enabled there would be a false security guarantee.
    if (!isNative()) {
      console.warn("[trivo] biometric protection requires the Android application");
      return;
    }
    await initializeBiometricOnce();
    if (!state.getSnapshot().isAvailable) {
      console.warn("[trivo] biometric hardware or enrollment unavailable");
      return;
    }
    if (!await authenticateBiometric()) return;
  }

  // The lock preference is security-sensitive: never claim it was enabled
  // if storage is blocked and persistence cannot be verified.
  if (!isStorageAvailable("localStorage")) {
    console.warn("[trivo] cannot change biometric protection without persistent storage");
    return;
  }
  safeStorage.set(BIOMETRIC_KEY, String(!enabled));
  if (safeStorage.get(BIOMETRIC_KEY) !== String(!enabled)) {
    console.warn("[trivo] biometric preference write did not persist");
    return;
  }
  state.update({ isEnabled: !enabled, isLocked: false });
}

export function useBiometricAuth() {
  const snapshot = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    state.getSnapshot,
  );
  useEffect(() => {
    void initializeBiometricOnce();
  }, []);

  return {
    ...snapshot,
    authenticate: authenticateBiometric,
    toggle: toggleBiometric,
  };
}
