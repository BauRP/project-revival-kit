/**
 * Expiry decisions are independent of UI rendering. A power-off device may
 * miss its deletion deadline, so purge on startup and when returning to the
 * foreground, with a one-minute watchdog while the WebView is alive.
 */
export function hasExpiredMessage(deleteAt: unknown, now: number): boolean {
  return typeof deleteAt === "number" && Number.isSafeInteger(deleteAt) &&
    deleteAt > 0 && Number.isSafeInteger(now) && deleteAt <= now;
}

let liveMonitors = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let removeVisibility: (() => void) | null = null;
let purgeInFlight = false;

async function purge(): Promise<void> {
  if (purgeInFlight) return;
  purgeInFlight = true;
  try {
    const { purgeExpiredLocalMessages } = await import("./p2p");
    await purgeExpiredLocalMessages();
  } catch (error) {
    console.warn("[retention] unable to purge expired messages", error);
  } finally {
    purgeInFlight = false;
  }
}

export function startMessageRetentionMonitor(): () => void {
  if (typeof window === "undefined") return () => {};
  liveMonitors++;
  if (!timer) {
    const wake = () => { void purge(); };
    document.addEventListener("visibilitychange", wake);
    removeVisibility = () => document.removeEventListener("visibilitychange", wake);
    timer = setInterval(wake, 60_000);
    wake(); // replay after process death, even with no chat screen open
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    liveMonitors--;
    if (liveMonitors === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      removeVisibility?.();
      removeVisibility = null;
    }
  };
}
