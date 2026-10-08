import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { onionCurrentStatus, onionInit, onionOnStatus } from "@/lib/onion-engine";
import type { TorStatus } from "@/lib/tor-native";

/**
 * Stage B of startup: shows the real Tor transport state and lets the user
 * retry without restarting the app. Never blocks the UI.
 */
export function TransportStatusChip({ userId }: { userId: string }) {
  const [status, setStatus] = useState<TorStatus>(() => onionCurrentStatus());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onionOnStatus(setStatus), []);

  const start = useCallback(async () => {
    if (!userId || document.visibilityState !== "visible") return;
    setBusy(true);
    setError(null);
    try {
      await onionInit(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [userId]);

  // Start once the UI is idle and visible (foreground-service rules).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const kick = () => {
      if (!cancelled && document.visibilityState === "visible") void start();
    };
    const timer = window.setTimeout(kick, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, start]);

  const ready = status.bootstrapped && !!status.onion;
  const label = ready
    ? "Tor connected"
    : busy || status.running
      ? `Tor ${status.bootstrapPercent}%`
      : "Tor offline";
  const Icon = ready ? ShieldCheck : error || status.lastError ? ShieldAlert : Shield;
  const reason = error ?? status.lastError ?? undefined;

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy || ready}
      title={reason}
      aria-label={`${label}${reason ? `: ${reason}` : ""}. Tap to retry.`}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-80"
    >
      <Icon className={`h-3 w-3 ${ready ? "text-primary" : ""}`} />
      {label}
      {!ready && !busy && <RefreshCw className="h-3 w-3" />}
    </button>
  );
}
