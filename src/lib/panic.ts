import { nukeAllData } from "./storage";
import { onionShutdownNative } from "./onion-engine";
import { dxdb } from "./dexie-db";
import { goHome } from "./home-navigation";

let panicActive = false;

export async function executePanic(): Promise<void> {
  if (panicActive) return;
  panicActive = true;

  try {
    await onionShutdownNative();
    dxdb.close();
    await dxdb.delete();
    await nukeAllData();
    goHome();
  } catch {
    goHome();
  }
}

export function createPanicLongPress(onPanic: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const HOLD_DURATION = 3000;

  const start = () => {
    timer = setTimeout(() => {
      onPanic();
    }, HOLD_DURATION);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
  };
}
