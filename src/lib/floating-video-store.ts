import { useEffect, useState } from "react";
import type { FloatingVideoSource } from "@/components/FloatingVideo";

/**
 * Phase 2 §4 — Cross-component PiP store.
 *
 * A trivial event-driven singleton so any component can request the global
 * floating window (e.g. ChatRoom shrinking a video when the user navigates
 * back to the chat list). Avoids prop-drilling through Index.tsx.
 */

let current: FloatingVideoSource | null = null;
const listeners = new Set<(v: FloatingVideoSource | null) => void>();

export const setFloatingVideo = (v: FloatingVideoSource | null) => {
  current = v;
  for (const l of listeners) l(v);
};

export const getFloatingVideo = () => current;

export const useFloatingVideo = () => {
  const [v, setV] = useState<FloatingVideoSource | null>(current);
  useEffect(() => {
    listeners.add(setV);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
};
