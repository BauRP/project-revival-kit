import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ExternalLink,
  EyeOff,
  FileText,
  Fingerprint,
  Globe,
  Languages,
  Mail,
  Moon,
  Shield,
  Sun,
  Trash2,
  Wifi,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useIdentity } from "@/contexts/IdentityContext";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { languageNames } from "@/i18n/translations";
import TransparencyPage from "./TransparencyPage";
import TranslationSettingsPanel from "./TranslationSettingsPanel";
import { Switch } from "./ui/switch";
import { nukeAllData } from "@/lib/storage";
import { isDataSaverEnabled, setDataSaverEnabled } from "@/lib/data-saver";

interface SettingsPageProps {
  onBack: () => void;
}

const readStoredBoolean = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
};

const writeStoredBoolean = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable in private WebViews; UI state still updates.
  }
};

type SettingsRowProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void | Promise<void>;
};

const SettingsSwitchRow = ({ icon, title, description, checked, onToggle }: SettingsRowProps) => {
  const nextChecked = !checked;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void onToggle(nextChecked)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void onToggle(nextChecked);
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-neutral-800/70 dark:active:bg-neutral-800 pointer-events-auto touch-manipulation"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-primary dark:bg-neutral-800">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-gray-900 dark:text-neutral-100">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-4 text-gray-500 dark:text-neutral-400">
            {description}
          </p>
        )}
      </div>
      <div onClick={(event) => event.stopPropagation()} className="shrink-0 pointer-events-auto">
        <Switch
          checked={checked}
          onCheckedChange={(value) => void onToggle(value)}
          aria-label={title}
        />
      </div>
    </div>
  );
};

const SettingsLinkRow = ({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-neutral-800/70 dark:active:bg-neutral-800 pointer-events-auto touch-manipulation"
  >
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-primary dark:bg-neutral-800">
      {icon}
    </div>
    <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-neutral-100">
      {title}
    </span>
    <ArrowLeft size={14} className="shrink-0 rotate-180 text-gray-400 dark:text-neutral-500" />
  </button>
);

const settingsGroupClass =
  "overflow-hidden rounded-2xl border border-gray-300 bg-white shadow-sm divide-y divide-gray-100 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:divide-neutral-800/60 pointer-events-auto";

const SettingsPage = ({ onBack }: SettingsPageProps) => {
  const { theme, setTheme } = useTheme();
  const { t, language, setLanguage } = useLanguage();
  const { stealthMode, toggleStealth, deleteAccount } = useIdentity();
  const { isEnabled: biometricEnabled, toggle: toggleBiometric } = useBiometricAuth();

  const [notifications, setNotifications] = useState(() =>
    readStoredBoolean("trivo-notifications", true),
  );
  const [hideContent, setHideContent] = useState(() =>
    readStoredBoolean("trivo-hide-content", false),
  );
  const [dataSaver, setDataSaver] = useState(() => isDataSaverEnabled());
  const [showTransparency, setShowTransparency] = useState(false);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLanguageSheet, setShowLanguageSheet] = useState(false);

  // Android hardware Back / web Back / Esc must pop THIS screen back to
  // Profile instead of exiting the app. Layered LIFO: any open sub-sheet or
  // modal closes first.
  useBackNavigation(
    showDeleteModal,
    useCallback(() => {
      setShowDeleteModal(false);
      return true;
    }, []),
  );
  useBackNavigation(
    showLanguageSheet,
    useCallback(() => {
      setShowLanguageSheet(false);
      return true;
    }, []),
  );
  useBackNavigation(
    true,
    useCallback(() => {
      if (showTransparency) {
        setShowTransparency(false);
        return true;
      }
      if (showTranslationSettings) {
        setShowTranslationSettings(false);
        return true;
      }
      onBack();
      return true;
    }, [onBack, showTransparency, showTranslationSettings]),
  );

  const handleToggleNotifications = useCallback(async (checked: boolean) => {
    setNotifications(checked);
    writeStoredBoolean("trivo-notifications", checked);
    if (checked && "Notification" in window) {
      try {
        await Notification.requestPermission();
      } catch {
        // Permission prompts may be blocked by the WebView; keep preference state stable.
      }
    }
  }, []);

  const handleToggleHideContent = useCallback((checked: boolean) => {
    setHideContent(checked);
    writeStoredBoolean("trivo-hide-content", checked);
  }, []);

  const handleToggleDataSaver = useCallback((checked: boolean) => {
    setDataSaver(checked);
    setDataSaverEnabled(checked);
  }, []);

  const handleToggleTheme = useCallback(
    (checked: boolean) => {
      setTheme(checked ? "dark" : "light");
    },
    [setTheme],
  );

  const handleToggleBiometric = useCallback(() => {
    void toggleBiometric();
  }, [toggleBiometric]);

  const handleToggleStealth = useCallback(() => {
    toggleStealth();
  }, [toggleStealth]);

  const handleDeleteAccount = async () => {
    try {
      await nukeAllData();
      deleteAccount();
      window.location.reload();
    } catch {
      deleteAccount();
      window.location.reload();
    }
  };

  if (showTransparency) {
    return <TransparencyPage onBack={() => setShowTransparency(false)} />;
  }

  if (showTranslationSettings) {
    return <TranslationSettingsPanel onBack={() => setShowTranslationSettings(false)} />;
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="flex shrink-0 items-center gap-3 px-3 pb-2 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-2 text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 dark:text-neutral-200 dark:hover:bg-neutral-900 dark:active:bg-neutral-800"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-neutral-100">{t("settings")}</h1>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-3 scrollbar-hide pointer-events-auto">
        <section className="space-y-2">
          <p className="px-1 pt-2 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {t("settings")}
          </p>
          <div className={settingsGroupClass}>
            <SettingsSwitchRow
              icon={theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              title={t("darkTheme")}
              checked={theme === "dark"}
              onToggle={handleToggleTheme}
            />
            <button
              type="button"
              onClick={() => setShowLanguageSheet(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-neutral-800/70 dark:active:bg-neutral-800 pointer-events-auto touch-manipulation"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-primary dark:bg-neutral-800">
                <Globe size={18} />
              </div>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-neutral-100">
                {t("language")}
              </span>
              <span className="max-w-[45%] truncate text-xs font-medium text-primary">
                {languageNames[language as keyof typeof languageNames] ?? language}
              </span>
              <ArrowLeft
                size={14}
                className="shrink-0 rotate-180 text-gray-400 dark:text-neutral-500"
              />
            </button>
            <SettingsLinkRow
              icon={<Languages size={18} />}
              title={t("translationSettings")}
              onClick={() => setShowTranslationSettings(true)}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className="px-1 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {t("notificationsSection")}
          </p>
          <div className={settingsGroupClass}>
            <SettingsSwitchRow
              icon={<Bell size={18} />}
              title={t("notifications")}
              checked={notifications}
              onToggle={handleToggleNotifications}
            />
            <SettingsSwitchRow
              icon={<BellOff size={18} />}
              title={t("hideMessageContent")}
              description={t("hideMessageContentDesc")}
              checked={hideContent}
              onToggle={handleToggleHideContent}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className="px-1 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {t("dataAndMemory")}
          </p>
          <div className={settingsGroupClass}>
            <SettingsSwitchRow
              icon={<Wifi size={18} />}
              title={t("dataSaver")}
              description={t("dataSaverDesc")}
              checked={dataSaver}
              onToggle={handleToggleDataSaver}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className="px-1 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {t("securitySection")}
          </p>
          <div className={settingsGroupClass}>
            <SettingsSwitchRow
              icon={<Fingerprint size={18} />}
              title={t("biometricLock")}
              checked={biometricEnabled}
              onToggle={handleToggleBiometric}
            />
            <SettingsSwitchRow
              icon={<EyeOff size={18} />}
              title={t("invisibleMode")}
              description={t("invisibleModeDesc")}
              checked={stealthMode}
              onToggle={handleToggleStealth}
            />
            <SettingsLinkRow
              icon={<FileText size={18} />}
              title={t("technicalTransparency")}
              onClick={() => setShowTransparency(true)}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className="px-1 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {t("supportPrivacy")}
          </p>
          <div className={settingsGroupClass}>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-primary dark:bg-neutral-800">
                <Mail size={18} />
              </div>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-neutral-100">
                {t("supportEmail")}
              </span>
              <a href="mailto:trivo.support@proton.me" className="text-xs font-medium text-primary">
                trivo.support@proton.me
              </a>
            </div>
            <a
              href="https://baurp.github.io/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-neutral-800/70 dark:active:bg-neutral-800 pointer-events-auto touch-manipulation"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-primary dark:bg-neutral-800">
                <Shield size={18} />
              </div>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-neutral-100">
                {t("privacyPolicy")}
              </span>
              <ExternalLink size={14} className="shrink-0 text-gray-400 dark:text-neutral-500" />
            </a>
          </div>
        </section>

        {/* Tight, balanced tail: only the OS safe-area inset is reserved below
            the warning text — no dead space on any screen size. */}
        <div className="flex w-full flex-col items-center gap-2 pt-1 safe-pb">
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="flex w-full max-w-md items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 py-4 font-semibold text-destructive transition-colors hover:bg-destructive/20"
          >
            <Trash2 size={18} />
            {t("deleteAccount")}
          </button>
          <p className="w-full max-w-md px-1 text-center text-[11px] leading-4 text-gray-500 dark:text-neutral-400">
            {t("deleteAccountWarning")}
          </p>
        </div>
      </div>

      {/* Custom in-app language picker (bottom sheet). Replaces the native OS
          <select> dropdown so it matches the app theme exactly. */}
      {showLanguageSheet && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowLanguageSheet(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("language")}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl border-t border-gray-200 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex justify-center pt-3">
              <div className="h-1 w-10 rounded-full bg-gray-300 dark:bg-neutral-700" />
            </div>
            <h2 className="px-5 pb-2 pt-3 text-base font-bold text-gray-900 dark:text-neutral-100">
              {t("language")}
            </h2>
            <div className="max-h-[55vh] overflow-y-auto scrollbar-hide px-2 pb-2">
              {Object.entries(languageNames).map(([code, name]) => {
                const selected = code === language;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setLanguage(code);
                      setShowLanguageSheet(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                      selected
                        ? "bg-primary/10 text-primary"
                        : "text-gray-900 hover:bg-gray-100 active:bg-gray-200 dark:text-neutral-100 dark:hover:bg-neutral-800/70 dark:active:bg-neutral-800"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected ? "border-primary" : "border-gray-300 dark:border-neutral-600"
                      }`}
                    >
                      {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    {selected && <Check size={16} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-center text-lg font-bold text-destructive">{t("deleteAccount")}</h2>
            <p className="text-center text-sm leading-relaxed text-gray-500 dark:text-neutral-400">
              {t("deleteAccountConfirm")}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {t("deleteAccount")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
