import { nukeAllData } from "./storage";
import { onionStopForAccountDeletion, onionClearNativeInboxForAccountDeletion } from "./onion-engine";
import { eraseIdentityVault } from "./crypto";
import { runAccountWipe } from "./account-wipe";
import { pauseAutomaticBackupsForWipe } from "./auto-backup";
import { stopNetworkNoise } from "./stealth";
import { goHome } from "./home-navigation";

let panicActive = false;

/** Emergency deletion must obey the same ordering as normal account deletion. */
export async function executePanic(): Promise<void> {
  if (panicActive) return;
  panicActive = true;
  try {
    stopNetworkNoise();
    await pauseAutomaticBackupsForWipe();
    await runAccountWipe({
      stopTransport: onionStopForAccountDeletion,
      deleteDatabases: nukeAllData,
      clearNativeInbound: onionClearNativeInboxForAccountDeletion,
      eraseIdentityKeys: eraseIdentityVault,
    });
    goHome();
  } catch (error) {
    console.error("[panic] account wipe incomplete", error);
    if (typeof window !== "undefined")
      window.alert("Не удалось полностью удалить аккаунт. Данные могут остаться на устройстве. Повторите удаление или очистите данные приложения в настройках Android.");
  } finally {
    panicActive = false;
  }
}

export function createPanicLongPress(onPanic: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const start = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onPanic();
    }, 3000);
  };
  return {
    onTouchStart: start, onTouchEnd: cancel, onTouchCancel: cancel,
    onMouseDown: start, onMouseUp: cancel, onMouseLeave: cancel,
  };
}
