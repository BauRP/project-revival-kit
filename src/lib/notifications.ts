import { LocalNotifications } from "@capacitor/local-notifications";
import { Translation } from "@capacitor-mlkit/translation";
import {
  detectLanguage,
  getTranslationSettings,
  translateWithBundledDictionary,
} from "@/lib/translation-config";
import { isNative } from "@/lib/platform";
import { safeNotificationText, shouldNotifyChat, type NotificationPolicyInput } from "./notification-policy";

function preference(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

/** Respect privacy preferences BEFORE constructing any notification payload. */
export async function notifyIncomingMessage(title: string, body: string, policy: Omit<NotificationPolicyInput, "enabled"> = {}): Promise<void> {
  if (!shouldNotifyChat({ ...policy, enabled: preference("trivo-notifications", true) })) return;
  const { title: safeTitle, body: safeBody } = safeNotificationText(title, body, preference("trivo-hide-content", false));

  if (!isNative()) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(safeTitle, { body: safeBody });
    }
    return;
  }

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") return; // Permission requested in Settings, not per message.
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now() % 2147483647,
          title: safeTitle,
          body: safeBody,
          smallIcon: "ic_launcher_foreground",
          sound: "trivo_elite_notification.wav",
        },
      ],
    });
  } catch (error) {
    console.warn("[notifications] unable to show notification", error);
  }
}

export async function translateIncomingMessage(text: string): Promise<string | null> {
  const settings = await getTranslationSettings();
  if (!settings.autoTranslateIncoming || !text.trim()) return null;

  const detected = detectLanguage(text);
  if (!detected || detected !== settings.sourceLanguage) return null;

  return runTranslation(text, settings.sourceLanguage, settings.targetLanguage);
}

/**
 * Mirror-Inverse outgoing translator (V6 spec §3).
 * Inverts the user's configured incoming pair (source→target) into (target→source)
 * so an EN→RU listener sends in RU but their original RU input is replaced with EN.
 * Returns the translated string, or the original text if translation is unavailable
 * (caller decides whether to send original or block).
 */
export async function translateOutgoingInverse(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  const settings = await getTranslationSettings();
  // Inverse: outgoing source = incoming target, outgoing target = incoming source.
  const outSource = settings.targetLanguage;
  const outTarget = settings.sourceLanguage;
  return runTranslation(text, outSource, outTarget);
}

async function runTranslation(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string | null> {
  // Offline only: never forward private messages to a cloud translation API.
  // Prefer the bundled on-device phrase dictionary.
  const bundled = translateWithBundledDictionary(text, sourceLanguage, targetLanguage);
  if (bundled) return bundled;

  // Fallback 2: on-device ML Kit (native only).
  if (!isNative()) return null;
  try {
    const { text: translated } = await Translation.translate({
      text,
      sourceLanguage: sourceLanguage as any,
      targetLanguage: targetLanguage as any,
    });
    return translated;
  } catch {
    return null;
  }
}
