/**
 * One shared biometric state for the chat screen and settings page.
 * Components may mount/unmount independently but must never own separate
 * "enabled" values or briefly show unlocked UI on native cold launch.
 */
export interface BiometricState {
  isAvailable: boolean;
  isEnabled: boolean;
  isLocked: boolean;
}

export function initialBiometricLocked(enabled: boolean, native: boolean): boolean {
  return enabled && native;
}

export function createBiometricStore(initial: BiometricState) {
  let snapshot = { ...initial };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (changes: Partial<BiometricState>) => {
      const next = { ...snapshot, ...changes };
      if (Object.keys(next).every((key) =>
        next[key as keyof BiometricState] === snapshot[key as keyof BiometricState])) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}
