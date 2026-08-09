import { useState, useEffect, useCallback, useRef } from "react";
import { App, type AppState } from "@capacitor/app";
import { whenBridgeReady, runNative } from "@/lib/native-bridge";
import { safeStorage } from "@/lib/safe-storage";
import { isNative } from "@/lib/platform";

const BIOMETRIC_KEY = "trivo-biometric";

function biometricEnabled(): boolean {
  return safeStorage.get(BIOMETRIC_KEY) === "true";
}

export function useBiometricAuth() {
  const [isAvailable, setIsAvailable] = useState(false);
  // Lazy initializer goes through safeStorage: on a WebView with DOM storage
  // disabled the raw `localStorage` getter throws and would kill the mount.
  const [isEnabled, setIsEnabled] = useState(() => biometricEnabled());
  const [isLocked, setIsLocked] = useState(false);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const init = async () => {
      // Never probe biometrics before the native bridge exists.
      await whenBridgeReady();
      await checkAvailability();
      // Cold-start lock: when biometrics is enabled the user MUST authenticate
      // before any messenger UI is visible.
      if (biometricEnabled() && isNative()) {
        setIsLocked(true);
        await authenticate();
      }
    };
    void init().catch((error) => console.warn("[trivo] biometric init failed:", error));
  }, []);

  // Background-return lock: when the OS reports the app became active again
  // (Capacitor `appStateChange` with isActive=true), re-arm the lock.
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | undefined;
    let disposed = false;

    void runNative(
      "App",
      async () => {
        const listener = await App.addListener("appStateChange", (state: AppState) => {
          if (!biometricEnabled()) return;
          if (state.isActive) setIsLocked(true);
        });
        if (disposed) {
          void listener.remove();
        } else {
          handle = listener;
        }
        return true;
      },
      false,
      "biometric appStateChange listener",
    );

    return () => {
      disposed = true;
      try {
        void handle?.remove();
      } catch {
        /* removal is best effort */
      }
    };
  }, []);



  const checkAvailability = async () => {
    if (!isNative()) {
      setIsAvailable(false);
      return;
    }
    try {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      const result = await BiometricAuth.checkBiometry();
      setIsAvailable(result.isAvailable);
    } catch {
      setIsAvailable(false);
    }
  };

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!isNative()) {
      setIsLocked(false);
      return true;
    }
    try {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      await BiometricAuth.authenticate({
        reason: "Unlock Trivo Chat",
        cancelTitle: "Cancel",
      });
      setIsLocked(false);
      return true;
    } catch {
      // Keep locked on failure so user can retry
      return false;
    }
  }, []);

  const toggle = useCallback(async () => {
    if (!isEnabled) {
      const success = await authenticate();
      if (success) {
        setIsEnabled(true);
        safeStorage.set(BIOMETRIC_KEY, "true");
      }
    } else {
      setIsEnabled(false);
      safeStorage.set(BIOMETRIC_KEY, "false");
      setIsLocked(false);
    }
  }, [isEnabled, authenticate]);


  return { isAvailable, isEnabled, isLocked, toggle, authenticate };
}
